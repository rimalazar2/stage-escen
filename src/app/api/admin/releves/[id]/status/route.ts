import { NextResponse, after } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { sendStudentReleveStatusNotification } from "@/lib/resend";

/**
 * PUT /api/admin/releves/[id]/status
 * Met à jour le statut d'un relevé (annuler, remplacer, réactiver) ou son
 * verrouillage. Protégé, admin uniquement.
 * L'étudiant est prévenu par email à chaque changement le concernant.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createAdminClient();

    // Vérifier l'authentification
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: "Non autorisé." },
        { status: 401 }
      );
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { status, replaced_by, lock } = body as {
      status?: "cancelled" | "replaced" | "active";
      replaced_by?: string;
      /** true = verrouiller (locked_at = now), false = déverrouiller */
      lock?: boolean;
    };

    // Vérifier que le relevé existe (student_email nécessaire pour prévenir
    // l'étudiant en cas de changement de statut)
    const relevesTable = supabase.from("releves");
    const { data: existing } = await relevesTable
      .select("id, status, locked_at, student_name, student_email")
      .eq("id", id)
      .single();

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Relevé introuvable." },
        { status: 404 }
      );
    }

    // ── Verrouillage / déverrouillage ───────────────────────
    // Décision d'administration : suspend temporairement la consultation
    // publique sans annuler le document (le QR code reste valide, la page
    // affiche un message sobre). Réservé aux relevés actifs.
    if (typeof lock === "boolean") {
      if (existing.status !== "active") {
        return NextResponse.json(
          {
            success: false,
            error: "Seul un relevé actif peut être verrouillé ou déverrouillé.",
          },
          { status: 400 }
        );
      }

      // Anti no-op : on ne notifie pas l'étudiant pour un changement qui
      // n'en est pas un (re-verrouiller / re-déverrouiller n'a aucun effet).
      if ((lock && existing.locked_at) || (!lock && !existing.locked_at)) {
        return NextResponse.json(
          {
            success: false,
            error: lock
              ? "Ce relevé est déjà verrouillé."
              : "Ce relevé n'est pas verrouillé.",
          },
          { status: 400 }
        );
      }

      const { data: updated, error } = await relevesTable
        .update({ locked_at: lock ? new Date().toISOString() : null })
        .eq("id", id)
        .select()
        .single();

      if (error) {
        return NextResponse.json(
          { success: false, error: "Erreur lors de la mise à jour." },
          { status: 500 }
        );
      }

      await supabase.from("admin_logs").insert({
        admin_id: user.id,
        admin_email: user.email ?? "",
        action: lock ? "lock" : "unlock",
        target_releve_id: id,
        details: { previous_locked_at: existing.locked_at, locked_at: updated.locked_at },
      });

      // Prévenir l'étudiant (post-réponse, jamais bloquant)
      after(async () => {
        await sendStudentReleveStatusNotification({
          studentName: existing.student_name,
          studentEmail: existing.student_email ?? "",
          releveId: id,
          action: lock ? "locked" : "unlocked",
        });
      });

      return NextResponse.json({ success: true, data: updated });
    }

    if (!status || !["cancelled", "replaced", "active"].includes(status)) {
      return NextResponse.json(
        { success: false, error: "Statut invalide." },
        { status: 400 }
      );
    }

    // Seul un relevé actif peut être annulé ou remplacé.
    // Le statut "active" reste possible (retour en arrière après une erreur).
    if (status !== "active" && existing.status !== "active") {
      return NextResponse.json(
        {
          success: false,
          error: "Seul un relevé actif peut être annulé ou remplacé.",
        },
        { status: 400 }
      );
    }

    // Anti no-op : pas d'email étudiant si le statut ne change pas réellement
    // (ex: réactiver un relevé déjà actif).
    if (status === existing.status) {
      return NextResponse.json(
        {
          success: false,
          error: "Ce relevé est déjà dans cet état.",
        },
        { status: 400 }
      );
    }

    // Validation du remplacement : le remplaçant doit exister, être actif
    // et être différent du relevé remplacé (le QR code suivra la chaîne).
    // NB: on récupère aussi le nom de la nouvelle version (email étudiant).
    let replacementName: string | undefined;
    if (status === "replaced") {
      if (!replaced_by || replaced_by === id) {
        return NextResponse.json(
          {
            success: false,
            error: "Veuillez sélectionner le relevé qui remplace celui-ci.",
          },
          { status: 400 }
        );
      }

      const { data: target } = await relevesTable
        .select("id, status, student_name")
        .eq("id", replaced_by)
        .maybeSingle();

      if (!target || target.status !== "active") {
        return NextResponse.json(
          {
            success: false,
            error: "Le relevé de remplacement doit être actif.",
          },
          { status: 400 }
        );
      }

      replacementName = target.student_name;
    }

    // Mettre à jour le statut (replaced_by remis à NULL hors remplacement)
    const { data: updated, error } = await relevesTable
      .update({
        status,
        ...(status === "replaced" ? { replaced_by } : { replaced_by: null }),
      })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { success: false, error: "Erreur lors de la mise à jour." },
        { status: 500 }
      );
    }

    // Log l'action admin
    await supabase.from("admin_logs").insert({
      admin_id: user.id,
      admin_email: user.email ?? "",
      action: status === "cancelled" ? "cancel" : status === "replaced" ? "replace" : "reactivate",
      target_releve_id: id,
      details: { previous_status: existing.status, new_status: status, replaced_by },
    });

    // Prévenir l'étudiant (post-réponse, jamais bloquant)
    after(async () => {
      await sendStudentReleveStatusNotification({
        studentName: existing.student_name,
        studentEmail: existing.student_email ?? "",
        releveId: id,
        action: status === "replaced" ? "replaced" : status === "cancelled" ? "cancelled" : "active",
        ...(status === "replaced" ? { replacementName } : {}),
      });
    });

    return NextResponse.json({ success: true, data: updated });
  } catch {
    return NextResponse.json(
      { success: false, error: "Erreur serveur." },
      { status: 500 }
    );
  }
}
