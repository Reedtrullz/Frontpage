import { auth } from "@/auth";
import { isOwnerUser } from "@/lib/authz";
import { HeaderClient } from "./HeaderClient";

export async function Header() {
  const session = await auth();
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--border)] bg-[color:var(--surface)/0.94] backdrop-blur-md">
      <HeaderClient isOwner={isOwnerUser(session?.user)} />
    </header>
  );
}
