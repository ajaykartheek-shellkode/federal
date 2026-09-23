"use client";

import { useRef } from "react";
import { useVerification } from "@/components/providers/VerificationProvider";
import ReportOverlay from "@/components/report/ReportOverlay";
import type { DialogState } from "@/lib/store";
import { EditItemDialog, NewSessionDialog, OverrideDialog } from "./AuditDialogs";
import { AddItemDialog, RemoveItemDialog, ScalePhotoDialog } from "./InventoryDialogs";
import CollateralDialog from "./CollateralDialog";
import DamageDialog from "./DamageDialog";
import DocumentDialog from "./DocumentDialog";
import Lightbox from "./Lightbox";
import ScaleDialog from "./ScaleDialog";

type Of<K extends DialogState["kind"]> = Extract<DialogState, { kind: K }>;

/** Renders every dialog once; keeps the last props of each so exit animations play fully. */
export default function DialogHost() {
  const { state, closeDialog } = useVerification();
  const dialog = state.dialog;
  const last = useRef<Partial<{ [K in DialogState["kind"]]: Of<K> }>>({});
  if (dialog) (last.current as Record<string, DialogState>)[dialog.kind] = dialog;

  const is = (kind: DialogState["kind"]) => dialog?.kind === kind;
  const override = last.current.override;
  const edit = last.current.edit;
  const removeItem = last.current["remove-item"];
  const lightbox = last.current.lightbox;

  return (
    <>
      <CollateralDialog open={is("collateral")} onClose={closeDialog} />
      <DamageDialog open={is("damage")} ornamentId={last.current.damage?.ornamentId} onClose={closeDialog} />
      <DocumentDialog open={is("document")} onClose={closeDialog} />
      {override && <OverrideDialog open={is("override")} target={override.target} refId={override.ref} onClose={closeDialog} />}
      {edit && <EditItemDialog open={is("edit")} refId={edit.ref} onClose={closeDialog} />}
      <ScaleDialog open={is("scale")} onClose={closeDialog} />
      <ScalePhotoDialog open={is("scale-photo")} onClose={closeDialog} />
      <AddItemDialog open={is("add-item")} onClose={closeDialog} />
      {removeItem && <RemoveItemDialog open={is("remove-item")} refId={removeItem.ref} onClose={closeDialog} />}
      <NewSessionDialog open={is("new-session")} onClose={closeDialog} />
      {lightbox && (
        <Lightbox
          open={is("lightbox")}
          src={lightbox.src}
          title={lightbox.title}
          caption={lightbox.caption}
          contentType={lightbox.contentType}
          onClose={closeDialog}
        />
      )}
      <ReportOverlay open={is("report")} onClose={closeDialog} />
    </>
  );
}
