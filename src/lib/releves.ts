import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Releve } from "./types/database";

/**
 * Résout un identifiant vers la version active (la plus récente) d'un relevé.
 *
 * Suit la chaîne de remplacement (`replaced_by`) côté base via la fonction
 * SQL `resolve_active_releve` (SECURITY DEFINER, récursive). Le QR code d'une
 * ancienne version continue donc de fonctionner : il affiche la version
 * officielle à jour, sans jamais réimprimer le document (cahier des charges).
 *
 * Retourne `null` si l'identifiant est inconnu, annulé, ou si la chaîne de
 * remplacement est cassée — indistinguable d'un ID inconnu pour le public
 * (anti-fraude).
 */
export async function resolveActiveReleve(
  supabase: SupabaseClient<Database>,
  id: string
): Promise<Releve | null> {
  // NB: cast any — contournement du typage RPC de Supabase (même pattern
  // que les autres workarounds de typage du projet).
  // La fonction est déclarée RETURNS SETOF : PostgREST renvoie un tableau
  // (vide si aucun résultat actif).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- workaround de typage Supabase RPC
  const { data, error } = await (supabase.rpc as any)(
    "resolve_active_releve",
    { p_id: id }
  );

  if (error || !Array.isArray(data) || data.length === 0) return null;
  return data[0] as Releve;
}
