import { redirect } from "next/navigation";

/**
 * Superseded by /laboratory.
 *
 * The old screen read beds and lab orders as flat JSON records with no
 * admission, no ward assignment and no lab workflow. It has been replaced
 * rather than kept alongside, so there is only ever one screen for laboratory.
 */
export default function LegacyRedirect() {
  redirect("/laboratory");
}
