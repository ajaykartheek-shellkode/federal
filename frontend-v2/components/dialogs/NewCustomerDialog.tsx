"use client";

import { useEffect, useState } from "react";
import { useVerification } from "@/components/providers/VerificationProvider";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";
import { FieldError, Input, Label, Textarea } from "@/components/ui/Field";
import Icon from "@/components/ui/Icon";

const DEFAULT_BRANCH = "FED-MUM-001";
const digits = (value: string) => value.replace(/\D/g, "");

/**
 * A walk-in customer CBS doesn't hold yet. The branch takes their details here, the portal opens
 * the loan application, and the gold loan account follows on sanction.
 */
export default function NewCustomerDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { openApplication, state } = useVerification();
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [address, setAddress] = useState("");
  const [branch, setBranch] = useState(DEFAULT_BRANCH);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setMobile("");
      setIdNumber("");
      setAddress("");
      setBranch(DEFAULT_BRANCH);
      setTouched(false);
    }
  }, [open]);

  const errors = {
    name: name.trim().length < 2 ? "Enter the customer's full name." : "",
    mobile: digits(mobile).length < 10 || digits(mobile).length > 15 ? "Enter a valid mobile number." : "",
    idNumber: idNumber.trim().length < 6 ? "Enter the ID number from their proof (Aadhaar, PAN, passport…)." : "",
    branch: branch.trim().length < 3 ? "Enter the branch code, e.g. FED-MUM-001." : "",
  };
  const valid = !Object.values(errors).some(Boolean);
  const busy = state.busy === "start";

  const submit = async () => {
    setTouched(true);
    if (!valid) return;
    const ok = await openApplication({
      name: name.trim(),
      mobile: mobile.trim(),
      id_number: idNumber.trim(),
      address: address.trim(),
      branch: branch.trim().toUpperCase(),
    });
    if (ok) onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="md"
      icon="user"
      title="New customer"
      subtitle="Opens a gold loan application — the account number follows on sanction"
      dismissable={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="gold" icon="arrowRight" loading={busy} disabled={touched && !valid} onClick={submit}>
            Open application
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label htmlFor="nc-name" required>
              Customer name
            </Label>
            <Input
              id="nc-name"
              data-autofocus
              value={name}
              maxLength={120}
              placeholder="As printed on the ID proof"
              onChange={(e) => setName(e.target.value)}
              aria-invalid={touched && !!errors.name}
            />
            {touched && <FieldError>{errors.name}</FieldError>}
          </div>
          <div>
            <Label htmlFor="nc-mobile" required>
              Mobile
            </Label>
            <Input
              id="nc-mobile"
              type="tel"
              inputMode="tel"
              value={mobile}
              maxLength={24}
              placeholder="98200 41234"
              onChange={(e) => setMobile(e.target.value)}
              aria-invalid={touched && !!errors.mobile}
            />
            {touched && <FieldError>{errors.mobile}</FieldError>}
          </div>
          <div>
            <Label htmlFor="nc-id" required hint="checked against the proof later">
              ID number
            </Label>
            <Input
              id="nc-id"
              value={idNumber}
              maxLength={40}
              placeholder="Aadhaar / PAN / passport number"
              onChange={(e) => setIdNumber(e.target.value)}
              aria-invalid={touched && !!errors.idNumber}
            />
            {touched && <FieldError>{errors.idNumber}</FieldError>}
          </div>
          <div>
            <Label htmlFor="nc-branch" required>
              Branch
            </Label>
            <Input
              id="nc-branch"
              value={branch}
              maxLength={32}
              onChange={(e) => setBranch(e.target.value)}
              aria-invalid={touched && !!errors.branch}
              className="font-mono"
            />
            {touched && <FieldError>{errors.branch}</FieldError>}
          </div>
        </div>
        <div>
          <Label htmlFor="nc-address" hint="optional · used for the address match">
            Address
          </Label>
          <Textarea
            id="nc-address"
            value={address}
            maxLength={300}
            placeholder="As printed on the ID proof"
            onChange={(e) => setAddress(e.target.value)}
            className="min-h-[64px]"
            onKeyDown={(e) => e.key === "Enter" && e.metaKey && void submit()}
          />
        </div>
        <p className="flex items-start gap-2 rounded-xl bg-brand-50 px-3 py-2 text-xs text-brand-700">
          <Icon name="info" size={14} className="mt-px shrink-0" />
          These details go to CBS as the customer record, and the document step cross-verifies the ID proof against them.
        </p>
      </div>
    </Dialog>
  );
}
