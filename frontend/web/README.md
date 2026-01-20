# The Inventory Atlas' Frontend (Next.js)

The frontend of this project is a Next.js and TypeScript app that communicates with the C# API through localhost.

## Here are the steps to run it!

1) Start the backend API: (the inventory data is read from `inv.csv`, which can be dragged and dropped into the webpage)
   - Open a terminal in `yefymenko_victoria_CA/backend`
   - Run `dotnet run --project InventoryApi.csproj`
   - The API runs at `http://localhost:5050` 

2) Start the Next.js dev server: (this serves the UI at localhost:3000)
   - Open a terminal in `yefymenko_victoria_CA/frontend/web`
   - Run `npm run dev`
   - Open `http://localhost:3000` (this is the webpage!)

## Notes

- The UI calls `http://localhost:5050/api` directly (no proxy is used).
- CSV import/export is available in the UI and expects `code,description,price,quantity`. A sample CSV file is provided for import and already includes these fields.
- The backend uses C# global arrays with binary search and a CompareTo-based sort, as per the assignment requirements. All of the core logic and API endpoints can be found in Program.cs, so please pay the most attention to this when grading!
