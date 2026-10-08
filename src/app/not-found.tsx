import Link from "next/link";
export default function NotFound() {
  return (
    <div className="empty">
      <h1>Page not found</h1>
      <p>Choose a page in the sidebar or return to your overview.</p>
      <Link className="button primary" href="/">
        Go to overview
      </Link>
    </div>
  );
}
