/* This file contains the main frontend page component for the Inventory Atlas app!! These are the websites I used to help me out (alongside my previous hackathon projects):
- https://nextjs.org/docs/pages/api-reference/config/typescript 
- https://refine.dev/blog/next-js-with-typescript/#compiler-options 
- https://medium.com/@turingvang/guide-to-next-js-react-js-and-typescript-fbb7e675ba19 
- https://www.geeksforgeeks.org/typescript/next-js-typescript/ 
- https://nextjs.org/blog/building-apis-with-nextjs 
*/

"use client"; // The client component for interactive UI and browser APIs

import { useEffect, useMemo, useRef, useState } from "react"; // React hooks

type InventoryItem = { // UI model for an inventory row
  code: string;
  description: string;
  price: number;
  quantity: number;
};

type AnalyticsSnapshot = { // Analytics values shown on the dashboard
  totalItems: number;
  totalValue: number;
  averagePrice: number;
  medianPrice: number;
  priceRange: number;
};

const API_BASE = "http://localhost:5050/api"; // Backend API base for inventory actions
const OLLAMA_BASE = "http://localhost:11434"; // Local Ollama endpoint for AI insights (this almost blew up my CPU)

const currency = new Intl.NumberFormat("en-CA", { // Currency formatter for prices
  style: "currency",
  currency: "CAD",
});

function normalizeItem(raw: Record<string, unknown>): InventoryItem { // Normalizes the API payload casing
  return {
    code: String(raw.code ?? raw.Code ?? ""),
    description: String(raw.description ?? raw.Description ?? ""),
    price: Number(raw.price ?? raw.Price ?? 0),
    quantity: Number(raw.quantity ?? raw.Quantity ?? 0),
  };
}

function normalizeMetrics(raw: Record<string, unknown>): AnalyticsSnapshot { // Normalizes analytics payload casing
  return {
    totalItems: Number(raw.totalItems ?? raw.TotalItems ?? 0),
    totalValue: Number(raw.totalValue ?? raw.TotalValue ?? 0),
    averagePrice: Number(raw.averagePrice ?? raw.AveragePrice ?? 0),
    medianPrice: Number(raw.medianPrice ?? raw.MedianPrice ?? 0),
    priceRange: Number(raw.priceRange ?? raw.PriceRange ?? 0),
  };
}

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> { // Fetches the API wrapper with JSON error handling (I mainly learned about how to code API wrappers from my previous hackathon projects)
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = data?.message || response.statusText;
    throw new Error(message);
  }
  return data as T; // Returns the typed payload on success
}

async function ollamaChat(prompt: string, context: string): Promise<string> { // Sends a chat prompt and inventory context to Ollama (the AI model used). The AI logic and prompt design was very similar to my ICS3U cpt, where I coded an AI opponent for a Connect 4 game. This is an asynchronous function that uses the Fetch API to send a POST request to the Ollama API endpoint!
  const response = await fetch(`${OLLAMA_BASE}/api/chat`, {  // Sends a POST request to the Ollama chat API
    method: "POST",
    headers: { "Content-Type": "application/json" }, 
    body: JSON.stringify({ // The request body contains the model, streaming option, and messages
      model: "mistral:latest",
      stream: false,
      messages: [
        {
          role: "system",
          content: // The system message sets the behaviour of the AI model and allows it to reference the inventory context
            "You are an inventory analyst. Provide clear, practical suggestions based on the inventory data provided. " +
            "Keep responses concise, actionable, and specific to the items. " +
            "Respond with either 3 or 5 short bullet points.",
        },
        {
          role: "user",
          content: `Inventory context:\n${context}`, // Provides the AI with the current inventory data
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  const data = (await response.json()) as { // The response data type is defined here
    message?: { content?: string }; // The AI's reply message (an optional string)
    error?: string;
  };

  if (!response.ok) { // If the response is not ok, an error with the message from the response is thrown
    throw new Error(data?.error || "Failed to reach the AI service.");
  }

  return data?.message?.content?.trim() || "No response returned."; // This is a safe fallback output if content is missing from the AI
}

export default function Home() { // The main page component 
  const [items, setItems] = useState<InventoryItem[]>([]); // Inventory rows are called from the backend
  const [metrics, setMetrics] = useState<AnalyticsSnapshot>({ // Calls the analytics snapshot to create the dashboard cards
    totalItems: 0,
    totalValue: 0,
    averagePrice: 0,
    medianPrice: 0,
    priceRange: 0,
  });
  const [filter, setFilter] = useState(""); // Search term for filtering items
  const [sort, setSort] = useState("code-asc"); // Selected sort mode for the table
  const [editingCode, setEditingCode] = useState<string | null>(null); // Current edit target code
  const [code, setCode] = useState(""); // Form field: code
  const [description, setDescription] = useState(""); // Form field: description
  const [price, setPrice] = useState(""); // Form field: price
  const [quantity, setQuantity] = useState(""); // Form field: quantity
  const [formMessage, setFormMessage] = useState(""); // Inline form feedback
  const [formError, setFormError] = useState(false); // Form error styling flag
  const [tableMessage, setTableMessage] = useState(""); // Table-level feedback
  const [tableError, setTableError] = useState(false); // Table error styling flag
  const [busy, setBusy] = useState(false); // Disables inventory actions while loading
  const [aiBusy, setAiBusy] = useState(false); // Disables AI actions while waiting
  const [aiInput, setAiInput] = useState(""); // AI prompt input text
  const [aiMessages, setAiMessages] = useState<
    { role: "user" | "assistant"; content: string }[]
  >([]); // Conversation history for AI insights
  const [importBusy, setImportBusy] = useState(false); // Disables import/export buttons while processing
  const [importMessage, setImportMessage] = useState(""); // Import/export feedback message
  const [importError, setImportError] = useState(false); // Import/export error styling flag
  const [dragActive, setDragActive] = useState(false); // Dropzone hover state
  const fileInputRef = useRef<HTMLInputElement | null>(null); // Hidden file input for CSV upload

  const filteredItems = useMemo(() => { // After filtering and sorting, the final list of items is returned to the display
    const term = filter.toLowerCase(); // Converts the search term to lowrercase for case-insensitive matching
    const filtered = items.filter((item) => { // Filters items based on the search term
      if (!term) {
        return true;
      }
      return ( // Checks if the code or description includes the search term
        item.code.toLowerCase().includes(term) ||
        item.description.toLowerCase().includes(term)
      );
    });

    const [key, direction] = sort.split("-"); // e.g., "price-asc" -> ["price", "asc"] then splits the sort mode into a key and direction. I learned about array destructuring from my previous hackathon projects!
    return [...filtered].sort((a, b) => { // Sorts the filtered items based on the selected sort mode
      let left: string | number; // Left and right values for comparison
      let right: string | number; // These will be assigned based on the sort key

      if (key === "price") { // Determines the sort key (price, quantity, description, code) and assigns left/right values accordingly
        left = a.price;
        right = b.price;
      } else if (key === "quantity") {
        left = a.quantity;
        right = b.quantity;
      } else if (key === "description") {
        left = a.description.toLowerCase();
        right = b.description.toLowerCase();
      } else {
        left = a.code.toLowerCase();
        right = b.code.toLowerCase();
      }

      if (left < right) { // Compares left and right values for sorting in ascending or descending order
        if (direction === "asc") {
          return -1;
        }
        return 1;
      }
      if (left > right) {
        if (direction === "asc") {
          return 1;
        }
        return -1;
      }
      return 0;
    });
  }, [items, filter, sort]);

  const clearForm = () => { // Resets the form back to the "Add Item" state
    setEditingCode(null);
    setCode("");
    setDescription("");
    setPrice("");
    setQuantity("");
    setFormMessage("");
    setFormError(false);
  };

  const exitEditMode = () => { // Leaves edit mode when the list controls change
    if (editingCode) {
      clearForm();
    }
  };

  const startEditing = (item: InventoryItem) => { // Populates the form with existing values from the inventory
    setEditingCode(item.code);
    setCode(item.code);
    setDescription(item.description);
    setPrice(item.price.toString());
    setQuantity(item.quantity.toString());
    setFormMessage("Update the description or price, then save.");
    setFormError(false);
  };

  const loadData = async () => { // Loads the items and analytics from the API (this is an asynchronous function that fetches data from the backend API and updates the state accordingly)
    setBusy(true);
    setTableMessage("");
    setTableError(false);
    try {
      const [itemsResult, analyticsResult] = await Promise.allSettled([ // Fetches both inventory items and the analytics snapshot from the backend in parallel
        apiRequest<InventoryItem[]>("/items"), // Fetches the inventory items from the API
        apiRequest<AnalyticsSnapshot>("/analytics"), // Fetches the analytics snapshot from the API
      ]);

      if (itemsResult.status === "fulfilled") { // Checks if the inventory items were successfully fetched
        const normalized = itemsResult.value.map((item) =>
          normalizeItem(item as unknown as Record<string, unknown>)
        );
        setItems(normalized); // Normalizes and sets the inventory items in state
        if (editingCode && !normalized.some((item) => item.code === editingCode)) { // If the currently edited item was deleted, edit mode is exited
          clearForm();
        }
      } else {
        setTableMessage(itemsResult.reason?.message || "Failed to load items."); // Sets an error message if fetching the inventory items failed
        setTableError(true);
      }

      if (analyticsResult.status === "fulfilled") { // Checks if the analytics snapshot was successfully fetched
        setMetrics(
          normalizeMetrics(analyticsResult.value as Record<string, unknown>)  
        );
      }
    } catch (error) { // Catches any unexpected errors during the fetch process
      setTableMessage((error as Error).message);
      setTableError(true);
    } finally { // Finally a block to reset the busy state
      setBusy(false);
    }
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => { // Handles the add / update form submission (this is an asynchronous function that sends the form data to the backend API for adding or updating an inventory item)
    event.preventDefault();
    setFormMessage("");
    setFormError(false);

    const trimmedCode = code.trim().toUpperCase(); // Basic validation and trimming of form fields
    const trimmedDescription = description.trim();
    const numericPrice = Number(price);
    const numericQuantity = Number(quantity);

    if ( // Validates that all fields are filled and numeric values are valid
      !trimmedCode ||
      !trimmedDescription ||
      Number.isNaN(numericPrice) ||
      numericPrice < 0 ||
      Number.isNaN(numericQuantity) ||
      numericQuantity < 0 ||
      !Number.isInteger(numericQuantity)
    ) {
      setFormMessage("Please enter a code, description, price, and whole-number quantity."); // Sets an error message if the validation fails
      setFormError(true);
      return;
    }

    const payload = { // Prepares the payload for the API request
      code: trimmedCode,
      description: trimmedDescription,
      price: numericPrice,
      quantity: numericQuantity,
    };

    setBusy(true); // Sets the busy state to disable actions while processing. I learned how to do this using this website: https://reactjs.org/docs/handling-events.html
    try {
      if (editingCode) { // If editingCode is set, an existing item is being updated
        await apiRequest(`/items/${encodeURIComponent(trimmedCode)}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        setFormMessage("Item updated.");
      } else { // Otherwise, a new item is being added
        await apiRequest("/items", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setFormMessage("Item added.");
      }
      clearForm(); // Clears the form after successful submission
      await loadData();
    } catch (error) {
      setFormMessage((error as Error).message);
      setFormError(true);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (itemCode: string) => { // Confirms and deletes a row because the action cannot be undone
    if (!confirm(`Delete ${itemCode}? This cannot be undone.`)) {
      return;
    }

    setBusy(true); // Sets busy state while processing the deletion
    try {
      await apiRequest(`/items/${encodeURIComponent(itemCode)}`, { method: "DELETE" });
      exitEditMode();
      await loadData();
    } catch (error) { // Catches any errors during deletion and sends an error message
      setTableMessage((error as Error).message);
      setTableError(true);
    } finally { // Resets the busy state
      setBusy(false);
    }
  };

  const handleImport = async (file: File) => { // Uploads the CSV file to the backend and refreshes the inventory
    const isCsv = // Checks if the file is a CSV based on the file extension
      file.type === "text/csv" ||
      file.name.toLowerCase().endsWith(".csv"); // Basic file type check for CSV
    if (!isCsv) {
      setImportMessage("Only CSV files are allowed for import."); // Sets an error message if the file is not a CSV
      setImportError(true);
      return;
    }

    if (importBusy) { // Prevents multiple imports at the same time
      return;
    }

    setImportBusy(true); // Sets busy state while processing the import
    setImportMessage("");
    setImportError(false);

    try { // A try block to handle the file upload and API interaction
      const formData = new FormData();
      formData.append("file", file); // Appends the selected file to the form data

      const response = await fetch(`${API_BASE}/import`, { // Sends the file to the backend import endpoint
        method: "POST",
        body: formData,
      });
      const text = await response.text(); // Reads the response text
      const data = text ? JSON.parse(text) : null; // Parses the response JSON
      if (!response.ok) {
        throw new Error(data?.message || "Failed to import CSV."); // Throws an error if the response is not ok
      }

      setImportMessage("CSV imported successfully."); // Sets a success message on successful import
      await loadData();
    } catch (error) {
      setImportMessage((error as Error).message);
      setImportError(true);
    } finally {
      setImportBusy(false); // Resets the busy state
    }
  };

  const handleExport = async () => { // Downloads the current inventory as CSV
    try {
      const response = await fetch(`${API_BASE}/export`); // Calls the backend export endpoint to get the CSV file
      if (!response.ok) { // Checks if the response is ok
        throw new Error("Failed to export CSV.");
      }
      const blob = await response.blob(); // Reads the response as a Blob (a binary file-like object)
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "inventory.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) { // Catches any errors during export and sets an error message
      setImportMessage((error as Error).message);
      setImportError(true);
    }
  };

  const buildContext = () => { // Builds a text summary used by the AI prompt
    const summary = [
      `Total items: ${metrics.totalItems}`,
      `Total value: ${currency.format(metrics.totalValue || 0)}`,
      `Average price: ${currency.format(metrics.averagePrice || 0)}`,
      `Median price: ${currency.format(metrics.medianPrice || 0)}`,
      `Price range: ${currency.format(metrics.priceRange || 0)}`,
    ].join("\n");

    const rows = items // Appends each inventory item as a line in the context
      .map(
        (item) =>
          `${item.code} | ${item.description} | price ${item.price} | quantity in stock ${item.quantity}`
      )
      .join("\n");

    return `${summary}\n\nInventory items:\n${rows || "No items available."}`; // Returns the full context string
  };

  const handleAiSubmit = async (event: React.FormEvent<HTMLFormElement>) => { // Sends the user question to the AI
    event.preventDefault();
    const prompt = aiInput.trim();
    if (!prompt || aiBusy) { // Prevents empty prompts or multiple submissions
      return;
    }

    const context = buildContext(); // Builds the context string for the AI prompt
    setAiBusy(true);
    setAiInput("");
    setAiMessages((prev) => [...prev, { role: "user", content: prompt }]);

    try { // A try block to handle the AI request and response
      const response = await ollamaChat(prompt, context); // Sends the prompt and context to the Ollama chat function (my computer's storage is crying because of this model's download size)
      setAiMessages((prev) => [...prev, { role: "assistant", content: response }]); // Appends the AI's response to the conversation history
    } catch (error) {
      setAiMessages((prev) => [ // Appends an error message to the conversation history if the AI request fails
        ...prev,
        {
          role: "assistant",
          content: (error as Error).message || "AI request failed.",
        },
      ]);
    } finally {
      setAiBusy(false); // Resets the AI busy state
    }
  };

  useEffect(() => { // Loads the data on first render
    loadData();
  }, []);

  return ( // The main JSX layout of the page!!
    <div className="page">
      <div className="noise" aria-hidden="true" />
      <div className="shell">
      {/* App header with title and subtitle */}
      <header>
        <div>
          <h1>The Inventory Atlas</h1>
          <p className="lead">Manage stock, pricing, and analytics in one clean view.</p>
        </div>
      </header>

      {/* Analytics cards for quick reading */}
      <section className="metrics">
        <div className="metric">
          <h3>Total Items</h3>
          <p>{metrics.totalItems}</p>
        </div>
        <div className="metric">
          <h3>Total Value</h3>
          <p>{currency.format(metrics.totalValue || 0)}</p>
        </div>
        <div className="metric">
          <h3>Average Price</h3>
          <p>{currency.format(metrics.averagePrice || 0)}</p>
        </div>
        <div className="metric">
          <h3>Median Price</h3>
          <p>{currency.format(metrics.medianPrice || 0)}</p>
        </div>
        <div className="metric">
          <h3>Price Range</h3>
          <p>{currency.format(metrics.priceRange || 0)}</p>
        </div>
      </section>

      {/* Main layout: item form and inventory table */}
      <section className="grid">
        <div className="panel">
          {/* Add or update form */}
          <h2>{editingCode ? "Update Item" : "Add Item"}</h2>
          <form onSubmit={handleSubmit}>
            <div className="form-row">
              <label htmlFor="codeInput">Item Code</label>
              <input
                id="codeInput"
                type="text"
                placeholder="CAPRED"
                autoComplete="off"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                disabled={!!editingCode}
              />
              {/* Disables the code input when editing an existing item */}
            </div>
            <div className="form-row">
              <label htmlFor="descriptionInput">Description</label>
              <input
                id="descriptionInput"
                type="text"
                placeholder="Red baseball cap"
                autoComplete="off"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            {/* Description input field */}
            <div className="form-row">
              <label htmlFor="priceInput">Price</label>
              <input
                id="priceInput"
                type="number"
                step="0.01"
                min="0"
                placeholder="19.99"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
            </div>
            {/* Price input field */}
            <div className="form-row">
              <label htmlFor="quantityInput">Quantity</label>
              <input
                id="quantityInput"
                type="number"
                step="1"
                min="0"
                placeholder="10"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </div>
            {/* Quantity input field */}
            <div className="form-actions">
              <button className="primary" type="submit" disabled={busy}>
                Save Item
              </button>
              <button className="ghost" type="button" onClick={clearForm} disabled={busy}>
                Clear
              </button>
            </div>
            {/* Form action buttons */}
            {editingCode ? (
              <div className="pill">
                Editing <strong>{editingCode}</strong>
              </div>
            ) : null}
            <div className={`message${formError ? " error" : ""}`}>{formMessage}</div>
          </form>
        </div>
        
        {/* Search, sort, and refresh controls */}
        <div className="panel">
          {/* Search, sort, and refresh controls */}
          <div className="table-head">
            <h2>Inventory List</h2>
            <div className="filters">
              <input
                type="text"
                placeholder="Search code or description"
                value={filter}
                onChange={(event) => {
                  exitEditMode();
                  setFilter(event.target.value.trim());
                }}
              />
              <select
                value={sort}
                onChange={(event) => {
                  exitEditMode();
                  setSort(event.target.value);
                }}
              >
                {/* The sorting mode selection */}
                <option value="code-asc">Code (A-Z)</option>
                <option value="code-desc">Code (Z-A)</option>
                <option value="description-asc">Description (A-Z)</option>
                <option value="description-desc">Description (Z-A)</option>
                <option value="price-asc">Price (Low-High)</option>
                <option value="price-desc">Price (High-Low)</option>
                <option value="quantity-asc">Quantity (Low-High)</option>
                <option value="quantity-desc">Quantity (High-Low)</option>
              </select>
              {/* Reloads the button to refresh the inventory list */}
              <button
                className="ghost"
                type="button"
                onClick={() => {
                  exitEditMode();
                  loadData();
                }}
                disabled={busy}
              >
                Reload
              </button>
            </div>
          </div>
          <table>
            {/* Column headings */}
            <thead>
              <tr>
                <th>Code</th>
                <th>Description</th>
                <th>Price</th>
                <th>Qty</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {/* Empty state or mapped rows */}
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={5}>No items match your search.</td>
                </tr>
              ) : (
                filteredItems.map((item) => (
                  <tr key={item.code}>
                    <td className="code">{item.code}</td>
                    <td>{item.description}</td>
                    <td>{currency.format(item.price || 0)}</td>
                    <td>{item.quantity}</td>
                    <td>
                      <div className="actions">
                        <button className="ghost" type="button" onClick={() => startEditing(item)}>
                          Edit
                        </button>
                        <button
                          className="ghost danger"
                          type="button"
                          onClick={() => handleDelete(item.code)}
                          disabled={busy}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {/* Displays messages related to the table, such as errors or status updates */}
          <div className={`message${tableError ? " error" : ""}`}>{tableMessage}</div>
        </div>
      </section>
      {/* CSV import / export panel */}
      <section className="io-board">
        <div className="panel">
          <div className="io-head">
            <div>
              <h2>Import / Export CSV</h2>
              <p className="lead">
                Drag a CSV file here to replace the inventory, or export the current data.
              </p>
            </div>
          </div>
          <div
          /* The drag-and-drop CSV import dropzone */
            className={`dropzone${dragActive ? " active" : ""}`}
            // Drag-and-drop logic for CSV files
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            // Sets "drag active" state on drag over
            onDragLeave={() => setDragActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              const file = event.dataTransfer.files?.[0];
              if (file) {
                handleImport(file);
              }
            }}
            // Handles the file drop event
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                fileInputRef.current?.click();
              }
            }}
          >
            {/* The dropzone content that accepts CSV files only */} 
            <div className="dropzone-title">Drop CSV here or click to upload</div>
            <div className="dropzone-sub">Format: code,description,price,quantity</div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            hidden
            // Hidden file input for manual selection
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                handleImport(file);
              }
              event.target.value = "";
            }}
          />
          <div className="form-actions">
            {/* Export CSV button */}
            <button className="ghost" type="button" onClick={handleExport} disabled={importBusy}>
              Export CSV
            </button>
          </div>
          <div className={`message${importError ? " error" : ""}`}>{importMessage}</div>
        </div>
      </section>
      {/* AI insight board */}
      <section className="ai-board">
        <div className="panel">
          <div className="ai-head">
            <div>
              <h2>AI Insight Board</h2>
              <p className="lead">
                Ask for sales ideas, pricing tweaks, or inventory cleanup tips.
              </p>
            </div>
          </div>
          <div className="ai-feed">
            {aiMessages.length === 0 ? (
              <div className="ai-empty">
                Try: "How can I adjust this inventory to increase sales?"
              </div>
            ) : (
              aiMessages.map((message, index) => (
                <div key={index} className={`ai-message ${message.role}`}>
                  <span>{message.content}</span>
                </div>
              ))
            )}
          </div>
          {/* The AI insight input form */}
          <form className="ai-form" onSubmit={handleAiSubmit}>
            <textarea
              rows={3}
              placeholder="Ask the AI about pricing, promotions, or stock gaps..."
              value={aiInput}
              onChange={(event) => setAiInput(event.target.value)}
            />
            {/* The AI input textarea */}
            <div className="form-actions">
              <button className="primary" type="submit" disabled={aiBusy}>
                {aiBusy ? "Thinking..." : "Send"}
              </button>
              <button
                className="ghost"
                type="button"
                onClick={() => setAiMessages([])}
                disabled={aiBusy}
              >
                Clear Chat
              </button>
            </div>
          </form>
        </div>
      </section>
      </div>
    </div>
  );
}