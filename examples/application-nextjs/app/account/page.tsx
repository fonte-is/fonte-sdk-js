import { applicationJourney } from "../../server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  await applicationJourney.openAccount();
  return <main>Account access was verified by the existing application.</main>;
}
