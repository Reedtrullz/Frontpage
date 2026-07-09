import { getCanonicalPersonal } from "@/lib/content";
import type { PersonalContent, SocialLink } from "@/lib/content/schema";

export type { SocialLink };
export type PersonalData = PersonalContent;

export const personal: PersonalData = getCanonicalPersonal();
