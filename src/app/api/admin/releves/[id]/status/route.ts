import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

/**
 * PUT /api/admin/releves/[id]/status
 * Met à jour le statut d'un relevé (annuler, remplacer).
 * Protégé, admin uniquement.
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
    const { status, replaced_by } = body as {
      status?: "cancelled" | "replaced" | "active";
      replaced_by?: string;
    };

    if (!status || !["cancelled", "replaced", "active"].includes(status)) {
      return NextResponse.json(
        { success: false, error: "Statut invalide." },
        { status: 400 }
      );
    }

    // Vérifier que le relevé existe
    const relevesTable = supabase.from("releves");
    const { data: existing } = await relevesTable
      .select("id, status")
      .eq("id", id)
      .single();

    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Relevé introuvable." },
        { status: 404 }
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

    // Validation du remplacement : le remplaçant doit exister, être actif
    // et être différent du relevé remplacé (le QR code suivra la chaîne).
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
        .select("id, status")
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
      action: status === "cancelled" ? "cancel" : "replace",
      target_releve_id: id,
      details: { previous_status: existing.status, new_status: status, replaced_by },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch {
    return NextResponse.json(
      { success: false, error: "Erreur serveur." },
      { status: 500 }
    );
  }
}
