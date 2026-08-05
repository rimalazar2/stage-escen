/* ============================================================
   Icon — Icônes Google Material Symbols
   Remplace les emojis par de vraies icônes vectorielles
   (police officielle Google, ligatures, rendu pixel-perfect).
   ============================================================ */

export type IconName =
  | "space_dashboard" // tableau de bord
  | "description" // relevé / document
  | "history" // historique
  | "security" // alertes fraude / sécurité
  | "logout" // déconnexion
  | "verified" // authentifié
  | "check_circle" // succès
  | "cancel" // échec / refus
  | "block" // annulé
  | "lock" // verrouillé / verrouiller
  | "lock_open" // déverrouiller
  | "sync" // remplacement / version mise à jour
  | "qr_code" // QR code
  | "calendar_today" // date / aujourd'hui
  | "smartphone" // scan mobile
  | "search" // recherche
  | "filter_list" // filtres
  | "visibility" // détail
  | "close" // fermer
  | "download" // export
  | "link" // lien
  | "mail" // email
  | "schedule" // temps / tentative
  | "warning" // avertissement
  | "error" // erreur
  | "chevron_left"
  | "chevron_right"
  | "person"
  | "add";

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  /** Remplissage plein (variation FILL=1) — utile pour l'état actif */
  filled?: boolean;
  label?: string;
}

/**
 * Icône Material Symbols (Google). Le nom de l'icône est rendu via
 * ligature — la police doit être chargée (voir layout racine).
 * `aria-hidden` par défaut ; passer `label` pour une icône significative.
 */
export default function Icon({
  name,
  size = 20,
  className = "",
  filled = false,
  label,
}: IconProps) {
  return (
    <span
      className={`material-symbols-outlined select-none leading-none ${className}`}
      style={{
        fontSize: size,
        fontVariationSettings: filled ? `'FILL' 1, 'wght' 600` : `'FILL' 0, 'wght' 400`,
      }}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      {name}
    </span>
  );
}
