"use client";

import { useState, useEffect, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import type { Releve, Verification, ApiResponse } from "@/lib/types/database";

/**
 * Détail d'un relevé /admin/releves/[id]
 * Affiche les infos complètes et l'historique des vérifications.
 */
export default function AdminReleveDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [releve, setReleve] = useState<Releve | null>(null);
  const [verifications, setVerifications] = useState<Verification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isLocking, setIsLocking] = useState(false);
  const [predecessors, setPredecessors] = useState<Releve[]>([]);

  // ── État du flux de remplacement ──
  const [showReplaceModal, setShowReplaceModal] = useState(false);
  const [candidates, setCandidates] = useState<Releve[]>([]);
  const [candidateQuery, setCandidateQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [selectedReplacementId, setSelectedReplacementId] = useState<string | null>(null);
  const [isReplacing, setIsReplacing] = useState(false);
  const [replaceError, setReplaceError] = useState<string | null>(null);

  useEffect(() => {
    async function loadReleve() {
      try {
        const res = await fetch(`/api/admin/releves/${id}`);
        const data: ApiResponse<{
          releve: Releve;
          verifications: Verification[];
          predecessors?: Releve[];
        }> = await res.json();

        if (data.success && data.data) {
          setReleve(data.data.releve);
          setVerifications(data.data.verifications ?? []);
          setPredecessors(data.data.predecessors ?? []);
        } else {
          router.push("/admin/releves");
        }
      } catch {
        router.push("/admin/releves");
      } finally {
        setIsLoading(false);
      }
    }

    loadReleve();
  }, [id, router]);

  async function handleLockToggle() {
    if (!releve) return;
    setIsLocking(true);

    try {
      const res = await fetch(`/api/admin/releves/${id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lock: !releve.locked_at }),
      });

      const data = await res.json();
      if (data.success) {
        setReleve((prev) =>
          prev
            ? { ...prev, locked_at: prev.locked_at ? null : new Date().toISOString() }
            : prev
        );
      }
    } catch {
      // Erreur silencieuse
    } finally {
      setIsLocking(false);
    }
  }

  async function handleCancel() {
    if (!releve) return;
    setIsCancelling(true);

    try {
      const res = await fetch(`/api/admin/releves/${id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });

      const data = await res.json();
      if (data.success) {
        setReleve((prev) => prev ? { ...prev, status: "cancelled" } : prev);
      }
    } catch {
      // Erreur silencieuse
    } finally {
      setIsCancelling(false);
      setShowCancelConfirm(false);
    }
  }

  // ── Flux de remplacement ─────────────────────────────────
  // Charge les relevés actifs candidats au remplacement (nouvelle version).
  const loadCandidates = useCallback(async (query: string) => {
    setIsSearching(true);
    try {
      const params = new URLSearchParams({ status: "active", per_page: "15" });
      if (query.trim()) params.set("q", query.trim());
      const res = await fetch(`/api/admin/releves?${params}`);
      const data: ApiResponse<Releve[]> = await res.json();
      if (data.success && data.data) {
        setCandidates(data.data.filter((r) => r.id !== id));
      }
    } catch {
      setCandidates([]);
    } finally {
      setIsSearching(false);
    }
  }, [id]);

  function openReplaceModal() {
    setSelectedReplacementId(null);
    setReplaceError(null);
    setShowReplaceModal(true);
    // NB: le chargement des candidats est déclenché par l'effet debounce
    // (dépendance showReplaceModal) — pas de double requête ici.
  }

  // Recherche des candidats avec un léger debounce
  useEffect(() => {
    if (!showReplaceModal) return;
    const t = setTimeout(() => loadCandidates(candidateQuery), 300);
    return () => clearTimeout(t);
  }, [candidateQuery, showReplaceModal, loadCandidates]);

  async function handleReplace() {
    if (!releve || !selectedReplacementId) return;
    setIsReplacing(true);
    setReplaceError(null);

    try {
      const res = await fetch(`/api/admin/releves/${id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "replaced", replaced_by: selectedReplacementId }),
      });

      const data = await res.json();
      if (data.success) {
        setReleve((prev) =>
          prev
            ? { ...prev, status: "replaced", replaced_by: selectedReplacementId }
            : prev
        );
        setShowReplaceModal(false);
      } else {
        setReplaceError(data.error || "Erreur lors du remplacement.");
      }
    } catch {
      setReplaceError("Erreur de connexion. Veuillez réessayer.");
    } finally {
      setIsReplacing(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex items-center gap-2">
          <svg className="animate-spin h-5 w-5 text-escen-cyan" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm text-escen-text-secondary">Chargement...</span>
        </div>
      </div>
    );
  }

  if (!releve) {
    return (
      <div className="text-center py-12">
        <p className="text-escen-text-secondary">Relevé introuvable.</p>
        <button onClick={() => router.push("/admin/releves")} className="mt-4 text-sm text-escen-cyan hover:underline">
          ← Retour à la liste
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <button
            onClick={() => router.push("/admin/releves")}
            className="text-sm text-escen-text-secondary hover:text-escen-cyan transition-colors mb-2 block"
          >
            ← Retour
          </button>
          <h1 className="text-2xl font-bold text-escen-navy">{releve.student_name}</h1>
          <p className="text-sm text-escen-text-secondary">{releve.promo}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {releve.status === "active" && (
            <>
              <a
                href={`/api/releve/${releve.id}/qrcode`}
                download={`qrcode-${releve.student_id}.png`}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-escen-navy bg-white border border-escen-border rounded-xl hover:border-escen-cyan hover:text-escen-cyan transition-all duration-160"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <path d="M14 14h3v3h-3zM21 14h.01M14 21h.01M17 17h.01M21 17h.01M17 21h.01" />
                </svg>
                QR Code
              </a>
              <a
                href={`/api/releve/${releve.id}/pdf`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-escen-navy bg-white border border-escen-border rounded-xl hover:border-escen-cyan hover:text-escen-cyan transition-all duration-160"
              >
                <Icon name="description" size={16} />
                PDF officiel
              </a>
              <button
                onClick={handleLockToggle}
                disabled={isLocking}
                className={`px-4 py-2 text-sm font-semibold rounded-xl transition-all duration-160 inline-flex items-center gap-1.5 disabled:opacity-60 ${
                  releve.locked_at
                    ? "text-green-700 bg-green-50 border border-green-200 hover:bg-green-100"
                    : "text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100"
                }`}
              >
                <Icon
                  name={releve.locked_at ? "lock_open" : "lock"}
                  size={16}
                />
                {releve.locked_at
                  ? (isLocking ? "Déverrouillage..." : "Déverrouiller")
                  : (isLocking ? "Verrouillage..." : "Verrouiller le document")}
              </button>
              <button
                onClick={openReplaceModal}
                className="px-4 py-2 text-sm font-semibold text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-xl hover:bg-yellow-100 transition-all duration-160 inline-flex items-center gap-1.5"
              >
                <Icon name="sync" size={16} />
                Remplacer ce relevé
              </button>
              <button
                onClick={() => setShowCancelConfirm(true)}
                className="px-4 py-2 text-sm font-semibold text-red-600 bg-red-50 border border-red-200 rounded-xl hover:bg-red-100 transition-all duration-160 inline-flex items-center gap-1.5"
              >
                <Icon name="block" size={16} />
                Annuler ce relevé
              </button>
            </>
          )}
        </div>
      </div>

      {/* Bandeau : document verrouillé */}
      {releve.locked_at && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 mb-6 flex items-start gap-3">
          <Icon name="lock" size={20} className="text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-bold text-amber-800">
              Document verrouillé — consultation suspendue
            </p>
            <p className="text-xs text-amber-700/80 mt-0.5">
              Les visiteurs voient un message « Document temporairement indisponible ».
              Le document reste valide : déverrouillez-le pour rétablir la consultation.
              (Verrouillé le {new Date(releve.locked_at).toLocaleString("fr-FR")})
            </p>
          </div>
        </div>
      )}

      {/* Bandeau : relevé remplacé (le QR code reste valide) */}
      {releve.status === "replaced" && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-5 py-4 mb-6 flex items-start gap-3">
          <Icon name="sync" size={20} className="text-yellow-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-bold text-yellow-800">
              Relevé remplacé — le QR code reste valide
            </p>
            <p className="text-xs text-yellow-700/80 mt-0.5">
              Ce relevé a été remplacé par une nouvelle version. Le QR code déjà imprimé
              continue de fonctionner : il affiche désormais la version officielle à jour.
            </p>
          </div>
        </div>
      )}

      {/* Infos du relevé */}
      <div className="bg-white border border-escen-border rounded-xl p-6 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          <InfoField label="ID Relevé" value={releve.id} />
          <InfoField label="N° Étudiant" value={releve.student_id} />
          <InfoField label="Email étudiant" value={releve.student_email || "—"} />
          <InfoField label="Moyenne" value={releve.moyenne > 0 ? releve.moyenne.toFixed(2) : "—"} />
          <InfoField label="Mention" value={releve.mention || "—"} />
          <InfoField
            label="Statut"
            value={
              releve.status === "cancelled"
                ? "Annulé"
                : releve.status === "replaced"
                  ? "Remplacé"
                  : releve.locked_at
                    ? "Verrouillé"
                    : "Actif"
            }
          />
          <InfoField label="Créé le" value={new Date(releve.created_at).toLocaleDateString("fr-FR")} />
          <InfoField label="Mis à jour le" value={new Date(releve.updated_at).toLocaleDateString("fr-FR")} />
          {releve.replaced_by && (
            <InfoField
              label="Remplacé par"
              value={releve.replaced_by}
              href={`/admin/releves/${releve.replaced_by}`}
            />
          )}
        </div>

        {/* Notes */}
        <h3 className="text-sm font-bold text-escen-navy mb-3">Détail des notes</h3>
        {releve.notes_data && releve.notes_data.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-escen-border">
                  <th className="text-left py-2 text-xs font-semibold text-escen-text-secondary">Matière</th>
                  <th className="text-left py-2 text-xs font-semibold text-escen-text-secondary">Code</th>
                  <th className="text-center py-2 text-xs font-semibold text-escen-text-secondary">Crédits</th>
                  <th className="text-right py-2 text-xs font-semibold text-escen-text-secondary">Note</th>
                </tr>
              </thead>
              <tbody>
                {releve.notes_data.map((note, i) => (
                  <tr key={i} className="border-b border-escen-border/50">
                    <td className="py-2 font-medium text-escen-navy">{note.matiere}</td>
                    <td className="py-2 text-xs font-mono text-escen-text-secondary">{note.code}</td>
                    <td className="py-2 text-center">{note.credit}</td>
                    <td className="py-2 text-right font-semibold">{note.note.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-escen-text-secondary">Aucune note enregistrée.</p>
        )}
      </div>

      {/* Versions remplacées par ce relevé */}
      {predecessors.length > 0 && (
        <div className="bg-white border border-escen-border rounded-xl p-6 mb-6">
          <h2 className="text-sm font-bold text-escen-navy mb-3">
            Cette version remplace
          </h2>
          <div className="space-y-2">
            {predecessors.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-escen-cyan-50/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Icon name="sync" size={20} className="text-yellow-500" />
                  <div>
                    <p className="text-sm font-medium text-escen-navy">{p.student_name}</p>
                    <p className="text-xs text-escen-text-secondary">{p.promo}</p>
                  </div>
                </div>
                <a
                  href={`/admin/releves/${p.id}`}
                  className="text-xs font-semibold text-escen-cyan hover:underline"
                >
                  Voir l&apos;ancienne version →
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Historique des vérifications */}
      <div className="bg-white border border-escen-border rounded-xl p-6">
        <h2 className="text-sm font-bold text-escen-navy mb-4">
          Historique des vérifications ({verifications.length})
        </h2>

        {verifications.length > 0 ? (
          <div className="space-y-2">
            {verifications.map((v) => (
              <div
                key={v.id}
                className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-escen-cyan-50/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Icon
                    name={v.result === "success" ? "check_circle" : "cancel"}
                    size={20}
                    className={v.result === "success" ? "text-green-500" : "text-red-400"}
                  />
                  <div>
                    <p className="text-xs text-escen-text-secondary">
                      {new Date(v.timestamp).toLocaleString("fr-FR")}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                    v.result === "success" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
                  }`}>
                    {v.result === "success" ? "Succès" : "Échec"}
                  </span>
                  {v.error_type && (
                    <p className="text-[0.6rem] text-escen-text-secondary mt-0.5">{v.error_type}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-escen-text-secondary text-center py-4">
            Aucune vérification pour ce relevé.
          </p>
        )}
      </div>

      {/* Modal de confirmation d'annulation */}
      {showCancelConfirm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-[400px] w-full shadow-xl">
            <h3 className="text-lg font-bold text-escen-navy mb-2">Confirmer l&apos;annulation</h3>
            <p className="text-sm text-escen-text-secondary mb-6">
              Êtes-vous sûr de vouloir annuler ce relevé ? Cette action est irréversible.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="px-4 py-2 text-sm font-semibold text-escen-text-secondary bg-escen-bg border border-escen-border rounded-xl hover:bg-escen-border transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleCancel}
                disabled={isCancelling}
                className="px-4 py-2 text-sm font-semibold text-white bg-red-600 rounded-xl hover:bg-red-700 transition-colors disabled:opacity-60"
              >
                {isCancelling ? "Annulation..." : "Confirmer l'annulation"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de remplacement */}
      {showReplaceModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-6 max-w-[520px] w-full shadow-xl">
            <h3 className="text-lg font-bold text-escen-navy mb-1">Remplacer ce relevé</h3>
            <p className="text-xs text-escen-text-secondary mb-4">
              Sélectionnez la nouvelle version (déjà créée et active). Le QR code imprimé
              restera valide et affichera cette version à jour.
            </p>

            <input
              type="text"
              value={candidateQuery}
              onChange={(e) => setCandidateQuery(e.target.value)}
              placeholder="Rechercher par nom, n° étudiant, promotion..."
              className="w-full h-[44px] px-4 text-sm bg-escen-bg border border-escen-border rounded-xl outline-none focus:border-escen-cyan focus:ring-1 focus:ring-escen-cyan/30 mb-3"
            />

            <div className="max-h-[280px] overflow-y-auto border border-escen-border rounded-xl divide-y divide-escen-border/50">
              {isSearching ? (
                <p className="p-4 text-sm text-escen-text-secondary text-center">Recherche...</p>
              ) : candidates.length === 0 ? (
                <p className="p-4 text-sm text-escen-text-secondary text-center">
                  Aucun relevé actif trouvé. Créez d&apos;abord la nouvelle version.
                </p>
              ) : (
                candidates.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedReplacementId(c.id)}
                    className={`w-full text-left px-4 py-3 transition-colors ${
                      selectedReplacementId === c.id
                        ? "bg-escen-cyan-50 border-l-4 border-escen-cyan"
                        : "hover:bg-escen-cyan-50/50 border-l-4 border-transparent"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-escen-navy">{c.student_name}</p>
                        <p className="text-xs text-escen-text-secondary">{c.promo}</p>
                      </div>
                      <span className="text-[0.6rem] font-mono text-escen-text-secondary">
                        {c.id.slice(0, 8)}…
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>

            {replaceError && (
              <p role="alert" className="mt-3 text-sm font-medium text-red-600 bg-red-50 px-3 py-2 rounded-lg">
                {replaceError}
              </p>
            )}

            <div className="flex gap-3 justify-end mt-5">
              <button
                onClick={() => setShowReplaceModal(false)}
                className="px-4 py-2 text-sm font-semibold text-escen-text-secondary bg-escen-bg border border-escen-border rounded-xl hover:bg-escen-border transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleReplace}
                disabled={!selectedReplacementId || isReplacing}
                className="px-4 py-2 text-sm font-semibold text-white bg-yellow-600 rounded-xl hover:bg-yellow-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isReplacing ? "Remplacement..." : "Confirmer le remplacement"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function InfoField({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div>
      <p className="text-[0.6rem] font-semibold uppercase tracking-wider text-escen-text-secondary">{label}</p>
      {href ? (
        <a
          href={href}
          title={value}
          className="text-sm font-medium text-escen-cyan hover:underline break-all"
        >
          {value.slice(0, 13)}…
        </a>
      ) : (
        <p className="text-sm font-medium text-escen-navy break-all">{value}</p>
      )}
    </div>
  );
}
