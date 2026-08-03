/**
 * Test de bout en bout — Flux de remplacement (QR code « éternel »)
 *
 * Valide le comportement décrit au cahier des charges :
 *   « L'identifiant et le QR Code ne changent jamais, même si le relevé
 *    est corrigé plus tard. Une nouvelle version est publiée sous le même
 *    identifiant, pour éviter de réimprimer le document. »
 *
 * Scénario :
 *   1. v1 (active) → resolve(v1) = v1
 *   2. v1 remplacé par v2 → resolve(v1) = v2  (le QR code de v1 affiche v2)
 *   3. v2 remplacé par v3 → resolve(v1) = v3  (chaîne multi-sauts)
 *   4. v3 annulé → resolve(v1) = null          (chaîne cassée → not_found,
 *      indistinguable d'un identifiant inconnu, anti-fraude)
 *
 * Prérequis : avoir exécuté `npm run setup-db` (fonction SQL
 * resolve_active_releve) et configuré .env.local.
 *
 * Usage : npx tsx scripts/test-replacement.ts
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolveActiveReleve } from "../src/lib/releves";
import { loadEnv } from "./load-env";

// Charge .env.local (le script ne passe pas par Next.js)
loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// UUIDs déterministes isolés (c… = chaîne de test, nettoyés en fin de run)
const V1 = "c0000000-0000-4000-8000-0000000000a1";
const V2 = "c0000000-0000-4000-8000-0000000000a2";
const V3 = "c0000000-0000-4000-8000-0000000000a3";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  console.log(`   ${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function createReleve(client: SupabaseClient, id: string, studentId: string, moyenne: number) {
  const { error } = await client.from("releves").insert({
    id,
    student_name: `Test Chaîne ${studentId}`,
    student_id: studentId,
    promo: "Test — remplacement",
    notes_data: [{ matiere: "Test", code: "TST", credit: 3, note: moyenne }],
    mention: "",
    moyenne,
    status: "active",
    pdf_url: "",
  });
  if (error) throw new Error(`insert ${id}: ${error.message}`);
}

async function setStatus(client: SupabaseClient, id: string, status: string, replaced_by?: string) {
  const { error } = await client
    .from("releves")
    .update({ status, ...(replaced_by ? { replaced_by } : { replaced_by: null }) })
    .eq("id", id);
  if (error) throw new Error(`update ${id}: ${error.message}`);
}

async function main() {
  console.log("=".repeat(56));
  console.log("   ESCEN — Test E2E : flux de remplacement (QR code éternel)");
  console.log("=".repeat(56));

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
    console.error("\n❌ Variables d'environnement manquantes (NEXT_PUBLIC_SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY).");
    process.exit(1);
  }

  const admin = createClient(supabaseUrl, supabaseServiceKey);
  const anon = createClient(supabaseUrl, supabaseAnonKey);

  // Nettoyage préalable (idempotence)
  await admin.from("releves").delete().in("id", [V1, V2, V3]);

  console.log("\n📄 Création de 3 versions (v1, v2, v3)...");
  await createReleve(admin, V1, "TESTCHAIN001", 12.0);
  await createReleve(admin, V2, "TESTCHAIN002", 14.0);
  await createReleve(admin, V3, "TESTCHAIN003", 15.5);

  console.log("\n🧪 1. Une version active se résout vers elle-même");
  const r1 = await resolveActiveReleve(anon, V1);
  check("resolve(v1) = v1", r1?.id === V1, r1?.id ?? "null");

  console.log("\n🔁 2. v1 remplacé par v2 → le QR code de v1 affiche v2");
  await setStatus(admin, V1, "replaced", V2);
  const r2 = await resolveActiveReleve(anon, V1);
  check("resolve(v1) = v2", r2?.id === V2, r2?.id ?? "null");
  const r2b = await resolveActiveReleve(anon, V2);
  check("resolve(v2) = v2", r2b?.id === V2, r2b?.id ?? "null");

  console.log("\n🔗 3. Chaîne multi-sauts : v2 remplacé par v3 → resolve(v1) = v3");
  await setStatus(admin, V2, "replaced", V3);
  const r3 = await resolveActiveReleve(anon, V1);
  check("resolve(v1) = v3 (2 sauts)", r3?.id === V3, r3?.id ?? "null");

  console.log("\n🚫 4. v3 annulé → chaîne cassée → not_found (anti-fraude)");
  await setStatus(admin, V3, "cancelled");
  const r4 = await resolveActiveReleve(anon, V1);
  check("resolve(v1) = null", r4 === null, String(r4?.id));
  const r4b = await resolveActiveReleve(anon, V3);
  check("resolve(v3, annulé) = null", r4b === null, String(r4b?.id));

  console.log("\n🧹 Nettoyage des données de test...");
  await admin.from("releves").delete().in("id", [V1, V2, V3]);

  console.log("\n" + "=".repeat(56));
  if (failures === 0) {
    console.log("   ✅ TEST RÉUSSI — le QR code ne « meurt » jamais.");
  } else {
    console.log(`   ❌ ${failures} vérification(s) en échec.`);
    process.exitCode = 1;
  }
  console.log("=".repeat(56));
}

main().catch((err) => {
  console.error("\n❌ Erreur fatale :", err);
  process.exit(1);
});
