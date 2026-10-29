"use server";

import { reportInput } from "../../server/report-input";
import { applicationJourney } from "../../server/runtime";

export async function saveReportAction(formData: FormData) {
  await applicationJourney.saveReport(
    reportInput(formData.get("title"), formData.get("body")),
  );
}
