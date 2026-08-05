"use client";

import Icon, { type IconName } from "@/components/Icon";
import type { VerifyResponse } from "@/lib/types/database";
import type { Locale } from "@/lib/types/database";
import ReleveDisplay from "./ReleveDisplay";

interface VerificationResultProps {
  result: VerifyResponse;
  locale: Locale;
  onReset: () => void;
  /** Identifiant saisi/scanné — permet d'afficher « version mise à jour » si
   *  le QR code d'une ancienne version résout vers la version active. */
  requestedId?: string;
}

/**
 * Affiche le résultat d'une vérification.
 * Gère tous les cas : succès, verrouillé, introuvable, rate limité, erreur.
 */
export default function VerificationResult({ result, locale, onReset, requestedId }: VerificationResultProps) {
  const isFrench = locale === "fr";

  // ── Succès : afficher le relevé ──────────────────────────
  if (result.success && result.data?.releve) {
    return (
      <div className="w-full animate-fade-in">
        <ReleveDisplay
          releve={result.data.releve}
          locale={locale}
          requestedId={requestedId}
          verificationId={result.data.verificationId}
          verifiedAt={new Date().toLocaleString(isFrench ? "fr-FR" : "en-GB")}
        />
        <div className="mt-6 text-center">
          <button
            onClick={onReset}
            className="px-6 py-3 text-sm font-semibold text-escen-navy bg-white border border-escen-border rounded-xl hover:border-escen-cyan hover:text-escen-cyan transition-all duration-160 inline-flex items-center gap-1.5"
          >
            <Icon name="chevron_left" size={18} />
            {isFrench ? "Nouvelle vérification" : "New verification"}
          </button>
        </div>
      </div>
    );
  }

  // ── Relevé annulé ────────────────────────────────────────
  // NB: l'API ne renvoie jamais "cancelled" — un relevé annulé est
  // indistinguable d'un identifiant inconnu (anti-fraude, RLS).
  // Le cas est donc traité par "not_found" ci-dessous.

  // ── Document verrouillé (décision d'administration) ──────
  // Message sobre mais distinct d'un identifiant inconnu : le verrouillage
  // est une décision officielle (litige, examen) — le visiteur sait que le
  // document existe mais n'est pas consultable pour l'instant.
  if (result.error?.code === "locked") {
    return (
      <ErrorCard
        icon="lock"
        title={isFrench
          ? "Document temporairement indisponible"
          : "Document temporarily unavailable"}
        message={isFrench
          ? "Ce document est temporairement indisponible pour consultation. Veuillez réessayer ultérieurement."
          : "This document is temporarily unavailable for viewing. Please try again later."}
        onReset={onReset}
        locale={locale}
      />
    );
  }

  // ── Identifiant non trouvé ───────────────────────────────
  if (result.error?.code === "not_found") {
    return (
      <ErrorCard
        icon="search"
        title={isFrench ? "Identifiant non reconnu" : "Unrecognized ID"}
        message={isFrench
          ? "Aucun relevé ne correspond à cet identifiant. Vérifiez le code saisi."
          : "No transcript matches this identifier. Please check the entered code."}
        onReset={onReset}
        locale={locale}
      />
    );
  }

  // ── Rate limité ──────────────────────────────────────────
  if (result.error?.code === "rate_limited") {
    return (
      <ErrorCard
        icon="schedule"
        title={isFrench ? "Trop de tentatives" : "Too many attempts"}
        message={isFrench
          ? "Vous avez effectué trop de tentatives. Veuillez réessayer dans quelques minutes."
          : "You have made too many attempts. Please try again in a few minutes."}
        onReset={onReset}
        locale={locale}
      />
    );
  }

  // ── Outil d'automatisation détecté ────────────────────────
  if (result.error?.code === "bot_detected") {
    return (
      <ErrorCard
        icon="security"
        title={isFrench ? "Accès refusé" : "Access denied"}
        message={isFrench
          ? "Une tentative d'automatisation a été détectée. Si vous êtes un visiteur légitime, rechargez la page et réessayez."
          : "An automation attempt was detected. If you are a legitimate visitor, please reload the page and try again."}
        onReset={onReset}
        locale={locale}
      />
    );
  }

  // ── CAPTCHA refusé ───────────────────────────────────────
  if (result.error?.code === "captcha_failed") {
    return (
      <ErrorCard
        icon="error"
        title={isFrench ? "Vérification anti-robot" : "Bot check"}
        message={isFrench
          ? "La vérification anti-robot a échoué. Veuillez réessayer."
          : "The bot check failed. Please try again."}
        onReset={onReset}
        locale={locale}
      />
    );
  }

  // ── Erreur serveur ───────────────────────────────────────
  return (
    <ErrorCard
      icon="warning"
      title={isFrench ? "Erreur technique" : "Technical error"}
      message={isFrench
        ? "Une erreur est survenue. Veuillez réessayer ou contacter le support."
        : "An error occurred. Please try again or contact support."}
      onReset={onReset}
      locale={locale}
    />
  );
}

function ErrorCard({
  icon,
  title,
  message,
  onReset,
  locale,
}: {
  icon: IconName;
  title: string;
  message: string;
  onReset: () => void;
  locale: Locale;
}) {
  const isFrench = locale === "fr";

  return (
    <div className="w-full max-w-[480px] mx-auto animate-fade-in">
      <div className="bg-white border border-escen-border rounded-2xl p-8 text-center shadow-[0_10px_30px_rgba(29,43,107,0.08)]">
        <div className="w-14 h-14 mx-auto mb-4 bg-escen-cyan-50 border border-escen-cyan-100 rounded-2xl flex items-center justify-center">
          <Icon name={icon} size={28} className="text-escen-navy" />
        </div>
        <h2 className="text-xl font-bold text-escen-navy mb-2">{title}</h2>
        <p className="text-sm text-escen-text-secondary leading-relaxed mb-6">
          {message}
        </p>
        <button
          onClick={onReset}
          className="px-6 py-3 text-sm font-semibold text-white bg-escen-navy rounded-xl hover:bg-escen-navy-500 active:scale-[0.97] transition-all duration-160 inline-flex items-center gap-1.5"
        >
          <Icon name="chevron_left" size={18} />
          {isFrench ? "Nouvelle vérification" : "New verification"}
        </button>
      </div>
    </div>
  );
}
