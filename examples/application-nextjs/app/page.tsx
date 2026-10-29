import { saveReportAction } from "./reports/actions";

export default function Page() {
  return (
    <main>
      <h1>Save a report</h1>
      <form action={saveReportAction}>
        <label>
          Title <input name="title" required maxLength={80} />
        </label>
        <label>
          Report <textarea name="body" maxLength={5_000} />
        </label>
        <button type="submit">Save report</button>
      </form>
    </main>
  );
}
