using System.Globalization; // Ensures numbers use period (1.5) instead of regional formats (1,5)
using System.Text; // Builds CSV output efficiently with StringBuilder
using System.Text.RegularExpressions; // Provides Regex (the regular expressions library) for CSV validation

public class Program // The main program class for the inventory API
{
    public static void Main(string[] args) // A main method / entry point for the inventory API
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder(args); // Builds the web host and service container object. This is the website I used to help me learn about building and implementing objects: https://medium.com/@lakstutor/c-builder-pattern-constructing-objects-step-by-step-97b583246599. 

        builder.Services.AddCors(options => // A lambda expression (needed to fit the Action parameter type in the method header) is used to configure CORS settings
        {
            options.AddDefaultPolicy(policy => // A lambda expression is used to configure the default policy
                policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod()); // Allow any origin, headers, and methods
        });

        WebApplication app = builder.Build(); // Finalizes the web app configuration and creates the app object
        app.UseCors(); // Enables CORS for all API endpoints

        string dataPath = Path.Combine(Directory.GetCurrentDirectory(), "inv.csv"); // Path to the inventory CSV file
        InventoryStore.Initialize(dataPath); // Loads CSV data into global arrays

        app.MapGet("/", () => Results.Ok(new { status = "Inventory API running" })); // Lambda returns a quick status response for the API. I researched refering to minimal APIs using https://learn.microsoft.com/en-us/aspnet/core/fundamentals/minimal-apis?view=aspnetcore-10.0 

        app.MapGet("/api/items", () => // Lambda returns every inventory item for the API
        {
            return Results.Ok(InventoryStore.GetAll());
        });

        app.MapGet("/api/items/{code}", (string code) => // Lambda receives an item code and returns one item
        {
            InventoryItem? item = InventoryStore.FindByCode(code); // Binary search is used for all code lookups
            if (item == null)
            {
                return Results.NotFound();
            }

            return Results.Ok(item);
        });

        app.MapPost("/api/items", (InventoryItemInput input) => // Lambda handles a POST request to add one item
        {
            string? validation = ValidateInput(input); // Checks code, description, price, and quantity
            if (validation != null)
                return Results.BadRequest(new { message = validation });

            (bool IsSuccess, InventoryItem? Item, string? ErrorMessage) result = InventoryStore.Add(input); // Attempts to add the item to the inventory. If there is an error, an error message is outputted to the user
            if (result.IsSuccess)
                return Results.Created($"/api/items/{result.Item!.Code}", result.Item);

            return Results.Conflict(new { message = result.ErrorMessage });
        });

        app.MapPut("/api/items/{code}", (string code, InventoryItemInput input) => // Lambda handles a PUT request to update one item
        {
            string? validation = ValidateInput(input); // Checks the code, description, price, and quantity
            if (validation != null)
                return Results.BadRequest(new { message = validation });

            if (!code.Equals(input.Code, StringComparison.OrdinalIgnoreCase)) // Ensures the URL /api/items/{code} code matches the body code
                return Results.BadRequest(new { message = "URL code must match payload code." });

            InventoryItem? updated = InventoryStore.Update(input); // Updates the arrays and CSV data accordingly
            if (updated == null)
                return Results.NotFound();

            return Results.Ok(updated);
        });

        app.MapDelete("/api/items/{code}", (string code) => // Lambda handles a DELETE request for one item
        {
            InventoryItem? removed = InventoryStore.Delete(code); // Removes the item from the arrays and CSV accordingly
            if (removed == null)
                return Results.NotFound();

            return Results.Ok(removed);
        });

        app.MapGet("/api/analytics", () => // Lambda returns summary statistics
        {
            return Results.Ok(InventoryStore.BuildAnalytics());
        });

        app.MapPost("/api/import", async (HttpRequest request) => // Async lambda handles CSV import (this reads the file stream and processes it asynchronously / without blocking or interrupting other requests on the server). I learned this using https://learn.microsoft.com/en-us/dotnet/csharp/asynchronous-programming/async-scenarios 
        {
            if (!request.HasFormContentType) // Ensures the request contains form data (the special request format browsers use for HTML forms and file uploads)
                return Results.BadRequest(new { message = "Expected multipart form data." });

            IFormCollection form = await request.ReadFormAsync(); // Reads the posted form data
            IFormFile? file = form.Files.FirstOrDefault(); // Takes the first uploaded file
            if (file == null)
                return Results.BadRequest(new { message = "CSV file is required." });

            using StreamReader reader = new StreamReader(file.OpenReadStream()); // Opens a streamreader to read the file
            string content = await reader.ReadToEndAsync(); // Reads the entire CSV file as text
            ImportResult result = InventoryStore.Import(content); // Validates and populates the arrays with the CSV file
            if (result.IsValid)
                return Results.Ok(result.Items);

            return Results.BadRequest(new { message = result.ErrorMessage }); // Returns any errors encountered 
        });

        app.MapGet("/api/export", () => // Lambda exports the inventory as CSV
        {
            string csv = InventoryStore.ExportCsv(); // Converts arrays to CSV text
            byte[] bytes = Encoding.UTF8.GetBytes(csv); // Converts text to bytes for download. I learned how to do this using https://learn.microsoft.com/en-us/dotnet/api/system.bitconverter.getbytes?view=net-10.0. 
            return Results.File(bytes, "text/csv", "inventory.csv");
        });

        app.Run("http://localhost:5050"); // Runs the API locally on port 5050 to allow for the export request
    }

    static string? ValidateInput(InventoryItemInput input) // Validates the API input fields
    {
        if (string.IsNullOrWhiteSpace(input.Code)) // An item code must be present
            return "Code is required.";

        if (string.IsNullOrWhiteSpace(input.Description)) // An item description must be present
            return "Description is required.";

        if (input.Price < 0) // The price cannot be negative
            return "Price must be zero or greater.";

        if (input.Quantity < 0) // The quantity cannot be negative
            return "Quantity must be zero or greater.";

        return null; // If the input is valid
    }

    static class InventoryStore
    {
        // The global arrays to store inventory data (item code, description, price, quantity). These must be private becase they should not be directly accessible outside of the InventoryStore class (and tehrefore only need to be visible to this class)
        private static string[] Code = new string[1000]; // Stores item codes
        private static string[] Description = new string[1000]; // Stores item descriptions 
        private static double[] Price = new double[1000]; // Stores item prices 
        private static int[] Quantity = new int[1000]; // Stores item quantities 
        private static int Count; // Tracks the number of valid items in the arrays

        private static object SyncRoot = new object(); // Used by lock to prevent conflicts between requests (This is one of best request handling methods I learned! I used it throughout one of my hackathon projects where I led the backend of a scam call detection program and the program had to handle multiple requests at once without crashing or corrupting data. I learned about it using https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/keywords/lock-statement)
        private static string? DataPath; // Stores the path to the inv.csv file

        public static void Initialize(string path) // A method to parse the CSV data into the arrays at startup
        {
            DataPath = path; // Saves the CSV path
            LoadFromCsv(path); // Reads the file and populates the arrays
        }

        public static List<InventoryItem> GetAll() // Returns a list of all items (we use a list due to the different data types stored)
        {
            lock (SyncRoot) // Ensures the arrays do not change while parsing (the lock, as mentioned previosuly, is for request handling)
                return BuildList();
        }

        public static InventoryItem? FindByCode(string code) // A method to find a single item by code (using binary search)
        {
            lock (SyncRoot) // Ensures the item does not change while parsing (the lock is for request handling)
            {
                int index = BinarySearchCode(code); // The binary search method is called
                if (index == -1) // If the item was not found
                    return null;

                return BuildItem(index);
            }
        }

        public static (bool IsSuccess, InventoryItem? Item, string? ErrorMessage) Add(InventoryItemInput input) // A method to add a new item to the inventory
        {
            lock (SyncRoot) // Ensures the item does not change while parsing (the lock is for request handling)
            {
                if (Count >= Code.Length) // Prevents writing past the end of the arrays
                    return (false, null, "Inventory is full.");

                string normalizedCode = NormalizeCode(input.Code); // Standardizes the code for searching and sorting (by removing spaces and converting to uppercase)
                if (BinarySearchCode(normalizedCode) >= 0) // Checks if the code already exists
                    return (false, null, $"Item with code '{normalizedCode}' already exists.");

                Code[Count] = normalizedCode; // Saves the code into the array
                Description[Count] = input.Description.Trim(); // Saves the description into the array
                Price[Count] = input.Price; // Saves the price into the array
                Quantity[Count] = input.Quantity; // Saves the quantity into the array
                Count++; // Increments the count 

                SortByCode(); // Keeps the arrays sorted by code for binary search
                UpdateInventory(); // Parses the new data to inv.csv

                InventoryItem item = new InventoryItem(normalizedCode, input.Description.Trim(), input.Price, input.Quantity); // Builds the item to return to the inventory API
                return (true, item, null);
            }
        }

        public static InventoryItem? Update(InventoryItemInput input) // A method to update an existing item
        {
            lock (SyncRoot) // Ensures the item does not change while parsing (the lock is for request handling)
            {
                string normalizedCode = NormalizeCode(input.Code); // Standardizes the code for searching (by removing spaces and converting to uppercase)
                int index = BinarySearchCode(normalizedCode); // Finds the item index using binary search
                if (index == -1) // If the item was not found
                    return null;

                Description[index] = input.Description.Trim(); // Updates the description
                Price[index] = input.Price; // Updates the price
                Quantity[index] = input.Quantity; // Updates the quantity

                SortByCode(); // Keeps the arrays sorted by code for binary search
                UpdateInventory(); // Parses the new data to inv.csv

                return new InventoryItem(normalizedCode, Description[index], Price[index], Quantity[index]); // Returns the updated item
            }
        }

        public static InventoryItem? Delete(string code) // A method to delete an item by code
        {
            lock (SyncRoot) // Ensures the item does not change while parsing (the lock is for request handling)
            {
                string normalizedCode = NormalizeCode(code); // Standardizes the code for searching (by removing spaces and converting to uppercase)
                int index = BinarySearchCode(normalizedCode); // Finds the item index using binary search
                if (index == -1) // If the item was not found
                    return null;

                InventoryItem removed = BuildItem(index); // Saves the item before removal
                ShiftLeft(index); // Shifts array data left to remove the gap
                Count--; // Decrements the item count

                UpdateInventory(); // Parses the new data to inv.csv
                return removed;
            }
        }

        public static ImportResult Import(string csvContent) // A method to import inventory from CSV text
        {
            lock (SyncRoot) // Ensures the arrays do not change while parsing (the lock is for request handling)
            {
                ImportResult parseResult = ParseItemsFromCsvStrict(csvContent); // Validates and parses the CSV
                if (!parseResult.IsValid) // If there were errors during parsing 
                    return parseResult;

                LoadFromList(parseResult.Items); // Copies the parsed items into the arrays
                SortByCode(); // Keeps the arrays sorted by code for binary search
                UpdateInventory(); // Parses the new data to inv.csv
                return new ImportResult(true, null, BuildList());
            }
        }

        public static string ExportCsv() // Exports the inventory as CSV text
        {
            lock (SyncRoot) // Ensures the arrays do not change while parsing (the lock is for request handling)
                return BuildCsv(); // Builds and returns the CSV text using the BuildCsv method
        }

        public static AnalyticsSnapshot BuildAnalytics() // Calculates the metrics for the analytics dashboard
        {
            lock (SyncRoot) // Ensures the arrays do not change while parsing (the lock is for request handling)
            {
                double totalValue = 0.0; // Sum of price * quantity
                double priceSum = 0.0; // Sum of prices for average calculation
                double[] prices = new double[Count]; // Stores prices for median and range
                double minPrice = double.MaxValue; // Tracks the lowest price
                double maxPrice = double.MinValue; // Tracks the highest price
                int minIndex = -1; // Stores the index of the lowest price item
                int maxIndex = -1; // Stores the index of the highest price item

                if (Count == 0) // Returns an empty snapshot if there are no items
                    return new AnalyticsSnapshot(0, 0, 0, 0, 0, 0, 0, null, null);

                for (int i = 0; i < Count; i++) // Loops through each item once
                {
                    totalValue += Price[i] * Quantity[i]; // Adds value using price * quantity
                    priceSum += Price[i]; // Adds the price for average
                    prices[i] = Price[i]; // Saves the price for sorting

                    if (Price[i] < minPrice) // Updates thelowest price
                    {
                        minPrice = Price[i];
                        minIndex = i;
                    }

                    if (Price[i] > maxPrice) // Updates the highest price
                    {
                        maxPrice = Price[i];
                        maxIndex = i;
                    }
                }

                Array.Sort(prices); // Sorts the prices to find the median and range (good ThreadExceptionEventArgs I took data management!)

                double average = priceSum / Count; // Mean of all prices
                double median; // Middle value after sorting

                if (prices.Length % 2 == 1) // If there is an odd number of prices, the middle value is taken
                    median = prices[prices.Length / 2];
                
                else // If there is an even number of prices, the median is the average of the two middle values
                {
                    double leftMiddle = prices[prices.Length / 2 - 1];
                    double rightMiddle = prices[prices.Length / 2];
                    median = (leftMiddle + rightMiddle) / 2;
                }

                double range = prices[prices.Length - 1] - prices[0]; // The range is the highest minus lowest value
                int aboveAverage = 0; // Counts prices greater than the mean
                int belowAverage = 0; // Counts prices less than the mean

                for (int i = 0; i < prices.Length; i++) // Loops through the prices to count how many are above/below average
                {
                    if (prices[i] > average)
                        aboveAverage++;
                    
                    else if (prices[i] < average)
                        belowAverage++;
                }

                InventoryItem? lowestItem = null; // Stores the lowest price item (if any)
                if (minIndex >= 0)
                    lowestItem = BuildItem(minIndex);

                InventoryItem? highestItem = null; // Stores the highest price item (if any)
                if (maxIndex >= 0)
                    highestItem = BuildItem(maxIndex);

                return new AnalyticsSnapshot( // Builds and returns the analytics snapshot
                    Count,
                    totalValue,
                    average,
                    median,
                    range,
                    aboveAverage,
                    belowAverage,
                    lowestItem,
                    highestItem);
            }
        }

        private static void LoadFromCsv(string path) // A method to read the inv.csv and fill the arrays
        {
            if (!File.Exists(path)) // Exits if the file does not exist
            {
                Count = 0;
                return;
            }

            string[] lines = File.ReadAllLines(path); // Reads all lines of the file into memory
            if (lines.Length == 0) // Handles an empty file
            {
                Count = 0;
                return;
            }

            int.TryParse(lines[0], out int declaredCount); // Reads the first line (the expected count)
            Count = 0; // Resets the array count before loading

            for (int i = 1; i < lines.Length && Count < declaredCount; i++) // Starts at line 2 for items
            {
                string[] parts = lines[i].Split(','); // Splits the CSV line into columns using the comma delimiter
                if (parts.Length != 3 && parts.Length != 4) // Accepts 3 or 4 columns only
                    continue;

                string code = parts[0].Trim(); // Normalizes the code by trimming whitespace
                string description = parts[1].Trim(); // Normalizes the description by trimming whitespace
                if (string.IsNullOrWhiteSpace(code) || string.IsNullOrWhiteSpace(description)) // Code and description are required
                    continue;

                if (!double.TryParse(parts[2].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out double price)) // Parses the price. (NumberStyles.Float tells C# to allow normal floating point formats and CultureInfo.InvariantCulture tells it to always use a dot as the decimal separator, not a comma)
                    continue;

                int quantity = 0; // The quantity is optional for older CSV files
                if (parts.Length == 4 && !int.TryParse(parts[3].Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out quantity))
                    quantity = 0;

                Code[Count] = NormalizeCode(code); // Saves the code
                Description[Count] = description; // Saves the description
                Price[Count] = price; // Saves the price
                Quantity[Count] = quantity; // Saves the quantity
                Count++; // Increments the count
            }

            SortByCode(); // Keeps the arrays sorted for binary search
        }

        private static void LoadFromList(List<InventoryItem> items) // A method to parse the list into arrays
        {
            Count = 0; // Resets the arrays before loading
            for (int i = 0; i < items.Count; i++) // Copies the items into the arrays until they are full
            {
                if (Count >= Code.Length) // Breaks if the arrays are full
                    break;

                Code[Count] = NormalizeCode(items[i].Code); // Saves the code
                Description[Count] = items[i].Description.Trim(); // Saves the description
                Price[Count] = items[i].Price; // Saves the price
                Quantity[Count] = items[i].Quantity; // Saves the quantity
                Count++; // Increments the count
            }
        }

        private static void UpdateInventory() // A method to write the arrays to inv.csv
        {
            if (DataPath == null) // Stops if the file path is not set
                return;

            File.WriteAllText(DataPath, BuildCsv()); // Writes the full CSV text to the disk
        }

        private static string BuildCsv() // A method to build CSV text from arrays
        {
            StringBuilder builder = new StringBuilder(); // Prepares a text builder for the CSV
            builder.AppendLine(Count.ToString(CultureInfo.InvariantCulture)); // Writes the item count on line 1 (and CultureInfo.InvariantCulture tells C# to always use a dot as the decimal separator, not a comma)
            for (int i = 0; i < Count; i++)
            {
                string price = Price[i].ToString("F2", CultureInfo.InvariantCulture); // Formats the price with 2 decimals
                builder.AppendLine($"{Code[i]},{Description[i]},{price},{Quantity[i]}"); // Writes one row by appending the corresponding values from the global arrays separated by commas
            }
            return builder.ToString();
        }

        private static ImportResult ParseItemsFromCsvStrict(string content) // A method to validate and parse CSV text
        {
            try // A try-catch block is used to handle unexpected errors during parsing of the user's CSV file
            {
                if (string.IsNullOrWhiteSpace(content)) // Stops if the file is empty
                    return new ImportResult(false, "CSV file is empty.", new List<InventoryItem>());

                string[] rawLines = content.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries); // Splits on new lines
                List<string> cleanedLines = new List<string>(); // Stores the trimmed, non-empty lines
                for (int i = 0; i < rawLines.Length; i++)
                {
                    string trimmed = rawLines[i].Trim(); // Trims the whitespace from each line
                    if (trimmed.Length > 0) // Skips empty lines
                        cleanedLines.Add(trimmed); 
                }

                string[] lines = cleanedLines.ToArray(); // Final cleaned lines
                if (lines.Length == 0) // Stops if there are no lines to the CSV file
                    return new ImportResult(false, "CSV file is empty.", new List<InventoryItem>());

                int startIndex = 0; // Interprets the first line as data (because line 0 is the count)
                if (int.TryParse(lines[0], NumberStyles.Integer, CultureInfo.InvariantCulture, out _)) // Skips the count line 
                    startIndex = 1;

                List<InventoryItem> items = new List<InventoryItem>(); // Stores the parsed items in a list due to varying data types
                for (int i = startIndex; i < lines.Length; i++)
                {
                    string[] parts = lines[i].Split(','); // Splits a CSV row into columns
                    int lineNumber = i + 1; // Returns a line number for error messages (i.e. if the user has a letter as a quanitiy on line 5, the error message will say error on line 5)
                    if (parts.Length != 3 && parts.Length != 4) // Accepts only 3 or 4 columns
                        return new ImportResult(false, $"Invalid column count on line {lineNumber}.", items);

                    string code = parts[0].Trim(); // Trims the whitespace from the item code
                    string description = parts[1].Trim(); // Trims the whitespace from the item description
                    if (string.IsNullOrWhiteSpace(code) || string.IsNullOrWhiteSpace(description)) // Code and description are required
                        return new ImportResult(false, $"Missing code or description on line {lineNumber}.", items);

                    string normalizedCode = NormalizeCode(code); // Normalizes the item code 
                    if (!Regex.IsMatch(normalizedCode, @"^[A-Z0-9]+$")) // Uses Regex.IsMatch(String, String) to verify that normalizedCode contains only A-Z or 0-9 characters (System.Text.RegularExpressions / Regex is a namespace); the pattern ^[A-Z0-9]+$ ensures that the entire string consists of only alphabetic or numeric characters
                        return new ImportResult(false, $"Invalid code format on line {lineNumber}.", items);

                    if (!double.TryParse(parts[2].Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out double price)) // Parses the price (and CultureInfo.InvariantCulture tells C# to always use a dot as the decimal separator, not a comma)
                        return new ImportResult(false, $"Invalid price on line {lineNumber}.", items);

                    int quantity = 0; // The quantity is optional if the first 3 columns are used
                    if (parts.Length == 4 && !int.TryParse(parts[3].Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out quantity)) // Parses the quantity (and CultureInfo.InvariantCulture tells C# to always use a dot as the decimal separator, not a comma)
                    {
                        return new ImportResult(false, $"Invalid quantity on line {lineNumber}.", items);
                    }

                    items.Add(new InventoryItem(normalizedCode, description, price, quantity)); // Saves the item
                }

                return new ImportResult(true, null, items);
            }
            catch (Exception ex) // Catches unexpected errors while parsing
            {
                return new ImportResult(false, $"Invalid CSV file: {ex.Message}", new List<InventoryItem>()); // Provides an appropriate error message
            }
        }

        private static void SortByCode() // A method that performs selection sort using .CompareTo() on the code array
        {
            for (int i = 0; i < Count - 1; i++) // Moves the boundary of the sorted section
            {
                int minIndex = i; // Tracks the smallest code in the remaining section
                for (int j = i + 1; j < Count; j++)
                {
                    if (Code[j].CompareTo(Code[minIndex]) < 0) // .CompareTo() is used for ordering strings in alphabetical order
                        minIndex = j;
                }

                if (minIndex != i) // Swaps when a smaller code is found
                    Swap(i, minIndex);
            }
        }

        private static int BinarySearchCode(string code) // This method sorts the Code array in ascending order using selection sort and string comparison
        {
            string target = NormalizeCode(code); // This normalizes the target code to match the stored format before searching
            int left = 0; // Starting index
            int right = Count - 1; // Ending index

            while (left <= right) // A loop that continues while the search range is valid
            {
                int mid = left + (right - left) / 2; // Calculates the middle index
                int comparison = Code[mid].CompareTo(target); // Compares the middle code to the target

                if (comparison == 0) // A matching target code is found
                    return mid;
                if (comparison < 0) // This moves the search to the right half when the midpoint is smaller
                    left = mid + 1;
                else // This moves the search to the left half when the midpoint is larger
                    right = mid - 1;
            }

            return -1; // The value was not found
        }

        private static void ShiftLeft(int startIndex) // A method to remove an item by shifting arrays left
        {
            for (int i = startIndex; i < Count - 1; i++) // Shifts each array element left starting from the removed index
            {
                Code[i] = Code[i + 1];
                Description[i] = Description[i + 1];
                Price[i] = Price[i + 1];
                Quantity[i] = Quantity[i + 1];
            }

            Code[Count - 1] = string.Empty; // Clears the last slot for the code after shifting
            Description[Count - 1] = string.Empty; // Clears the last slot for the description after shifting
            Price[Count - 1] = 0; // Clears the last slot for the price after shifting
            Quantity[Count - 1] = 0; // Clears the last slot for the quantity after shifting
        }

        private static void Swap(int leftIndex, int rightIndex) // A method to swap all arrays in parallel
        {
            string codeTemp = Code[leftIndex]; // Swaps the code values using a temporary variable
            Code[leftIndex] = Code[rightIndex]; 
            Code[rightIndex] = codeTemp; 

            string descriptionTemp = Description[leftIndex]; // Swaps the description values using a temporary variable
            Description[leftIndex] = Description[rightIndex];
            Description[rightIndex] = descriptionTemp;

            double priceTemp = Price[leftIndex]; // Swaps the price values using a temporary variable
            Price[leftIndex] = Price[rightIndex];
            Price[rightIndex] = priceTemp;

            int quantityTemp = Quantity[leftIndex]; // Swaps the quantity values using a temporary variable
            Quantity[leftIndex] = Quantity[rightIndex];
            Quantity[rightIndex] = quantityTemp;
        }

        private static InventoryItem BuildItem(int index) // A method to build a single item from the global arrays
        {
            return new InventoryItem(Code[index], Description[index], Price[index], Quantity[index]);
        }

        private static List<InventoryItem> BuildList() // A method to build a list of items from the global arrays
        {
            List<InventoryItem> items = new List<InventoryItem>(Count); // Initializes the list 
            for (int i = 0; i < Count; i++) 
                items.Add(BuildItem(i));

            return items;
        }

        private static string NormalizeCode(string code) // A method to "normalize" code strings
        {
            return code.Trim().ToUpperInvariant(); // Trims whitespace and converts to uppercase (ToUpperInvariant ensures consistent casing regardless of the server's conventions)
        }
    }

    // We use "record" types here to represent data structures that have "read-only" properties (good for data transfer objects). I learned about record types using https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/builtin-types/record
    record InventoryItem(string Code, string Description, double Price, int Quantity); // Represents one inventory item
    record InventoryItemInput(string Code, string Description, double Price, int Quantity); // Represents input from the API
    record AnalyticsSnapshot( // Represents the analytics summary that is returned to the frontend
        int TotalItems,
        double TotalValue,
        double AveragePrice,
        double MedianPrice,
        double PriceRange,
        int AboveAverageCount,
        int BelowAverageCount,
        InventoryItem? LowestItem,
        InventoryItem? HighestItem);
    record ImportResult(bool IsValid, string? ErrorMessage, List<InventoryItem> Items); // Represents the result of the CSV import validation
}
