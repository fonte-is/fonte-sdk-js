import Link from "next/link";

export default function Page() {
  return (
    <main>
      <h1>Fonte packed consumer</h1>
      <Link id="second-link" href="/second?utm_source=route">
        Second page
      </Link>
    </main>
  );
}
