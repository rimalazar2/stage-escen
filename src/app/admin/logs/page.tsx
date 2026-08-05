"use client";

import { useState, useEffect, useCallback } from "react";
import DataTable from "@/components/admin/DataTable";
import Icon from "@/components/Icon";
import type { Verification, ApiResponse } from "@/lib/types/database";

interface VerificationWithStudent extends Verification {
  releves: { student_name: string; student_id: string } | null;
}

/** Labels français des types d'erreur (journalisation enrichie) */
const ERROR_TYPE_LABELS: Record<string, string> = {
  invalid_id: "Identifiant inconnu",
  rate_limited: "Rate limit",
  captcha_failed: "CAPTCHA refusé",
  bot_detected: "Automation détectée",
  locked: "Document verrouillé",
};

/**
 * Page d'historique des vérifications /admin/logs
 * Journalisation enrichie : filtres (résultat, type d'erreur, signaux bots,
 * recherche d'identifiant, période) + détail complet par vérification.
 */
export default function AdminLogsPage() {
  const [verifications, setVerifications] = useState<VerificationWithStudent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [resultFilter, setResultFilter] = useState<string>("all");
  const [errorTypeFilter, setErrorTypeFilter] = useState<string>("all");
  const [signalsFilter, setSignalsFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<VerificationWithStudent | null>(null);
  const perPage = 50;

  const loadLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("per_page", String(perPage));
      if (resultFilter !== "all") params.set("result", resultFilter);
      if (errorTypeFilter !== "all") params.set("error_type", errorTypeFilter);
      if (signalsFilter === "yes") params.set("signals", "yes");
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      if (dateFrom) params.set("from", new Date(dateFrom).toISOString());
      if (dateTo) params.set("to", new Date(`${dateTo}T23:59:59`).toISOString());

      const res = await fetch(`/api/admin/verifications?${params}`);
      const data: ApiResponse<VerificationWithStudent[]> = await res.json();

      if (data.success && data.data) {
        setVerifications(data.data);
        setTotal(data.pagination?.total ?? 0);
      }
    } catch {
      // Erreur silencieuse
    } finally {
      setIsLoading(false);
    }
  }, [page, resultFilter, errorTypeFilter, signalsFilter, searchQuery, dateFrom, dateTo]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  // Reset de pagination quand un filtre change
  useEffect(() => {
    setPage(1);
  }, [resultFilter, errorTypeFilter, signalsFilter, searchQuery, dateFrom, dateTo]);

  async function handleExport() {
    try {
      const res = await fetch("/api/admin/verifications/export");
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `verifications-${new Date().toISOString().split("T")[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {
      // Erreur silencieuse
    }
  }

  const columns = [
    {
      key: "date",
      label: "Date",
      render: (v: VerificationWithStudent) => (
        <span className="text-xs text-escen-text-secondary whitespace-nowrap">
          {new Date(v.timestamp).toLocaleString("fr-FR")}
        </span>
      ),
    },
    {
      key: "student",
      label: "Étudiant",
      render: (v: VerificationWithStudent) => (
        <span className="text-sm font-medium text-escen-navy">
          {v.releves?.student_name ?? "—"}
        </span>
      ),
    },
    {
      key: "result",
      label: "Résultat",
      render: (v: VerificationWithStudent) => (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full ${
          v.result === "success"
            ? "bg-green-50 text-green-700"
            : "bg-red-50 text-red-600"
        }`}>
          <Icon
            name={v.result === "success" ? "check_circle" : "cancel"}
            size={14}
          />
          {v.result === "success" ? "Succès" : "Échec"}
        </span>
      ),
    },
    {
      key: "error_type",
      label: "Type d'erreur",
      render: (v: VerificationWithStudent) => (
        <span className="text-xs text-escen-text-secondary">
          {v.error_type
            ? ERROR_TYPE_LABELS[v.error_type] ?? v.error_type
            : "—"}
        </span>
      ),
    },
    {
      key: "signals",
      label: "Signaux",
      render: (v: VerificationWithStudent) =>
        v.signals && v.signals.length > 0 ? (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[0.65rem] font-semibold rounded-full bg-orange-50 text-orange-700">
            <Icon name="security" size={12} />
            {v.signals.length} détecté{v.signals.length > 1 ? "s" : ""}
          </span>
        ) : (
          <span className="text-xs text-escen-text-secondary/50">—</span>
        ),
    },
    {
      key: "ip",
      label: "IP (hashée)",
      render: (v: VerificationWithStudent) => (
        <span className="text-xs font-mono text-escen-text-secondary">
          {v.ip_address.slice(0, 12)}...
        </span>
      ),
    },
    {
      key: "actions",
      label: "",
      render: (v: VerificationWithStudent) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setDetail(v);
          }}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-escen-navy bg-escen-cyan-50 border border-escen-cyan-100 rounded-lg hover:bg-escen-cyan-100 transition-colors"
          aria-label="Voir le détail de la vérification"
        >
          <Icon name="visibility" size={14} />
          Détail
        </button>
      ),
    },
  ];

  const totalPages = Math.ceil(total / perPage);

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <h1 className="text-2xl font-bold text-escen-navy">
          Historique des vérifications
        </h1>
        <button
          onClick={handleExport}
          className="px-4 py-2 text-sm font-semibold text-escen-navy bg-white border border-escen-border rounded-xl hover:border-escen-cyan hover:text-escen-cyan transition-all duration-160 inline-flex items-center gap-2"
        >
          <Icon name="download" size={16} />
          Exporter CSV
        </button>
      </div>

      {/* Filtres enrichis */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3 mb-6">
        <select
          value={resultFilter}
          onChange={(e) => setResultFilter(e.target.value)}
          className="h-[44px] px-4 text-sm bg-white border border-escen-border rounded-xl outline-none focus:border-escen-cyan"
        >
          <option value="all">Tous les résultats</option>
          <option value="success">Succès uniquement</option>
          <option value="failed">Échecs uniquement</option>
        </select>

        <select
          value={errorTypeFilter}
          onChange={(e) => setErrorTypeFilter(e.target.value)}
          className="h-[44px] px-4 text-sm bg-white border border-escen-border rounded-xl outline-none focus:border-escen-cyan"
        >
          <option value="all">Tous les types d&apos;erreur</option>
          <option value="invalid_id">Identifiant inconnu</option>
          <option value="rate_limited">Rate limit</option>
          <option value="captcha_failed">CAPTCHA refusé</option>
          <option value="bot_detected">Automation détectée</option>
          <option value="locked">Document verrouillé</option>
        </select>

        <select
          value={signalsFilter}
          onChange={(e) => setSignalsFilter(e.target.value)}
          className="h-[44px] px-4 text-sm bg-white border border-escen-border rounded-xl outline-none focus:border-escen-cyan"
        >
          <option value="all">Avec ou sans signaux</option>
          <option value="yes">Signaux détectés uniquement</option>
        </select>

        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Rechercher un identifiant…"
          className="h-[44px] px-4 text-sm bg-white border border-escen-border rounded-xl outline-none focus:border-escen-cyan focus:ring-1 focus:ring-escen-cyan/30 placeholder:text-escen-text-secondary/60"
        />

        <div className="flex gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-[44px] px-3 text-sm bg-white border border-escen-border rounded-xl outline-none focus:border-escen-cyan w-full"
            aria-label="Date de début"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-[44px] px-3 text-sm bg-white border border-escen-border rounded-xl outline-none focus:border-escen-cyan w-full"
            aria-label="Date de fin"
          />
        </div>
      </div>

      {/* Compteur */}
      <p className="text-xs text-escen-text-secondary mb-4 text-right">
        {total} vérification{total > 1 ? "s" : ""}
      </p>

      {/* Tableau */}
      <DataTable
        columns={columns}
        data={verifications}
        keyExtractor={(v) => v.id}
        isLoading={isLoading}
        emptyMessage="Aucune vérification enregistrée."
      />

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-6">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-escen-navy bg-white border border-escen-border rounded-lg hover:border-escen-cyan disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Icon name="chevron_left" size={16} />
            Précédent
          </button>
          <span className="text-sm text-escen-text-secondary">
            Page {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-escen-navy bg-white border border-escen-border rounded-lg hover:border-escen-cyan disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Suivant
            <Icon name="chevron_right" size={16} />
          </button>
        </div>
      )}

      {/* Modale de détail */}
      {detail && (
        <VerificationDetailModal
          verification={detail}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

/**
 * Modale de détail complet d'une vérification (journalisation enrichie).
 */
function VerificationDetailModal({
  verification: v,
  onClose,
}: {
  verification: VerificationWithStudent;
  onClose: () => void;
}) {
  const fields: Array<{ label: string; value: string; mono?: boolean }> = [
    { label: "ID vérification", value: v.id, mono: true },
    { label: "Identifiant tenté", value: v.attempted_id || "—", mono: true },
    { label: "Étudiant", value: v.releves?.student_name ?? "—" },
    { label: "N° étudiant", value: v.releves?.student_id ?? "—" },
    { label: "Résultat", value: v.result === "success" ? "Succès" : "Échec" },
    {
      label: "Type d'erreur",
      value: v.error_type
        ? ERROR_TYPE_LABELS[v.error_type] ?? v.error_type
        : "—",
    },
    { label: "Date", value: new Date(v.timestamp).toLocaleString("fr-FR") },
    { label: "IP (hashée)", value: v.ip_address, mono: true },
    { label: "Navigateur (UA)", value: v.user_agent || "—" },
  ];

  return (
    <div
      className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl p-6 max-w-[560px] w-full shadow-xl max-h-[85dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Détail de la vérification"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-escen-navy">
            Détail de la vérification
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-escen-text-secondary hover:text-escen-navy hover:bg-escen-cyan-50 transition-colors"
            aria-label="Fermer"
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        <div className="space-y-2.5">
          {fields.map((f) => (
            <div key={f.label} className="flex flex-col sm:flex-row gap-1 sm:gap-3 text-sm">
              <span className="sm:w-44 shrink-0 text-[0.65rem] font-semibold uppercase tracking-wider text-escen-text-secondary sm:pt-1">
                {f.label}
              </span>
              <span className={`text-escen-navy break-all ${f.mono ? "font-mono text-xs pt-0.5" : ""}`}>
                {f.value}
              </span>
            </div>
          ))}

          {/* Signaux détectés */}
          <div className="flex flex-col sm:flex-row gap-1 sm:gap-3 text-sm pt-2 border-t border-escen-border/50">
            <span className="sm:w-44 shrink-0 text-[0.65rem] font-semibold uppercase tracking-wider text-escen-text-secondary sm:pt-1">
              Signaux détectés
            </span>
            <div className="flex flex-wrap gap-1.5">
              {v.signals && v.signals.length > 0 ? (
                v.signals.map((s) => (
                  <span
                    key={s}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-[0.65rem] font-semibold rounded-full bg-orange-50 text-orange-700 border border-orange-100"
                  >
                    <Icon name="security" size={12} />
                    {s}
                  </span>
                ))
              ) : (
                <span className="text-xs text-escen-text-secondary/60">
                  Aucun signal d&apos;automatisation
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-semibold text-white bg-escen-navy rounded-xl hover:bg-escen-navy-500 transition-colors"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
