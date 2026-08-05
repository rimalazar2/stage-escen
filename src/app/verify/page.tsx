"use client";

import { useState, useEffect } from "react";
import VerifyForm from "@/components/verify/VerifyForm";
import VerificationResult from "@/components/verify/VerificationResult";
import Icon from "@/components/Icon";
import type { VerifyResponse, Locale } from "@/lib/types/database";

/**
 * Page de vérification publique /verify
 * Permet de saisir manuellement un identifiant de relevé.
 */
export default function VerifyPage() {
  const [result, setResult] = useState<VerifyResponse | null>(null);
  const [requestedId, setRequestedId] = useState<string | null>(null);
  const [locale, setLocale] = useState<Locale>("fr");

  useEffect(() => {
    const lang = navigator.language?.startsWith("fr") ? "fr" : "en";
    setLocale(lang);
  }, []);

  return (
    <div className="min-h-dvh flex flex-col bg-escen-bg">
      {/* Hero section */}
      <div className="flex-1 flex flex-col items-center justify-center px-5 py-8">
        {/* Logo */}
        <div className="mb-6">
          <div className="w-16 h-16 bg-escen-navy rounded-2xl flex items-center justify-center shadow-lg">
            <span className="text-white font-bold text-xl">E</span>
          </div>
        </div>

        {!result ? (
          <>
            {/* Titre */}
            <h1 className="text-2xl md:text-3xl font-bold text-escen-navy text-center mb-2">
              {locale === "fr"
                ? "Vérification de relevé de notes"
                : "Transcript Verification"}
            </h1>
            <p className="text-sm text-escen-text-secondary text-center mb-8 max-w-md">
              {locale === "fr"
                ? "Entrez l'identifiant unique présent sur votre document pour vérifier son authenticité."
                : "Enter the unique identifier on your document to verify its authenticity."}
            </p>

            {/* Formulaire */}
            <VerifyForm
              locale={locale}
              onResult={(result, attemptedId) => {
                setResult(result);
                setRequestedId(attemptedId);
              }}
            />

            {/* Info QR Code */}
            <div className="mt-12 text-center">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-escen-cyan-50 rounded-xl border border-escen-cyan-100">
                <Icon name="smartphone" size={18} className="text-escen-cyan" />
                <p className="text-xs text-escen-text-secondary">
                  {locale === "fr"
                    ? "Scannez le QR Code sur votre relevé pour une vérification instantanée."
                    : "Scan the QR Code on your transcript for instant verification."}
                </p>
              </div>
            </div>
          </>
        ) : (
          <VerificationResult
            result={result}
            locale={locale}
            requestedId={requestedId ?? undefined}
            onReset={() => {
              setResult(null);
              setRequestedId(null);
            }}
          />
        )}
      </div>

      {/* Footer */}
      <footer className="text-center py-4">
        <p className="text-xs text-escen-text-secondary/60">
          ESCEN University — {locale === "fr" ? "Vérification officielle" : "Official verification"}
        </p>
      </footer>
    </div>
  );
}
