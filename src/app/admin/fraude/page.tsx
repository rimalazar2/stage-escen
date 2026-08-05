"use client";

import { useState, useEffect, useCallback } from "react";
import DataTable from "@/components/admin/DataTable";
import Icon from "@/components/Icon";
import type { ApiResponse } from "@/lib/types/database";

interface FraudAlertRow {
  id: string;
  identifier: string;
  attempt_count: number;
  ip_address: string;
  alerted_at: string;
}

/**
 * Page des alertes anti-fraude /admin/fraude
 * Journalisation enrichie : chaque alerte correspond à un identifiant qui
 * a subi un nombre anormal de tentatives échouées (seuil → email DSI).
 */
export default function AdminFraudePage() {
  const [alerts, setAlerts] = useState<FraudAlertRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const perPage = 50;

  const loadAlerts = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("per_page", String(perPage));

      const res = await fetch(`/api/admin/fraude?${params}`);
      const data: ApiResponse<FraudAlertRow[]> = await res.json();

      if (data.success && data.data) {
        setAlerts(data.data);
        setTotal(data.pagination?.total ?? 0);
      }
    } catch {
      // Erreur silencieuse
    } finally {
      setIsLoading(false);
    }
  }, [page]);

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  const columns = [
    {
      key: "identifier",
      label: "Identifiant visé",
      render: (a: FraudAlertRow) => (
        <span className="text-sm font-mono text-escen-navy">{a.identifier}</span>
      ),
    },
    {
      key: "attempt_count",
      label: "Tentatives échouées",
      render: (a: FraudAlertRow) => (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-red-50 text-red-600">
          <Icon name="warning" size={13} />
          {a.attempt_count}
        </span>
      ),
    },
    {
      key: "ip",
      label: "IP (hashée)",
      render: (a: FraudAlertRow) => (
        <span className="text-xs font-mono text-escen-text-secondary">
          {a.ip_address.slice(0, 16)}...
        </span>
      ),
    },
    {
      key: "date",
      label: "Déclenchée le",
      render: (a: FraudAlertRow) => (
        <span className="text-xs text-escen-text-secondary whitespace-nowrap">
          {new Date(a.alerted_at).toLocaleString("fr-FR")}
        </span>
      ),
    },
  ];

  const totalPages = Math.ceil(total / perPage);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-escen-navy mb-1">
          Alertes anti-fraude
        </h1>
        <p className="text-sm text-escen-text-secondary max-w-2xl">
          Un identifiant est signalé lorsqu&apos;il subit un nombre anormal de
          tentatives échouées (seuil atteint en 15 min). L&apos;administration a
          alors reçu un email, et l&apos;IP d&apos;origine a été bloquée temporairement.
          Une alerte maximum par identifiant toutes les 24 h.
        </p>
      </div>

      <p className="text-xs text-escen-text-secondary mb-4 text-right">
        {total} alerte{total > 1 ? "s" : ""}
      </p>

      <DataTable
        columns={columns}
        data={alerts}
        keyExtractor={(a) => a.id}
        isLoading={isLoading}
        emptyMessage="Aucune alerte de fraude. Tout est calme."
      />

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
    </div>
  );
}
