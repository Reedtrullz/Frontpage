"use server";

import { signIn, signOut } from "@/auth";
import { ownerCallbackPath } from "@/lib/owner-navigation";

export async function signInWithGitHub(formData: FormData) {
  await signIn("github", {
    redirectTo: ownerCallbackPath(formData.get("callbackUrl")),
  });
}

export async function signOutAction() {
  await signOut({ redirectTo: "/" });
}
