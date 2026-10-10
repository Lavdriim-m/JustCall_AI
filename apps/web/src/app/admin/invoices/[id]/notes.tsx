"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { updateInvoiceNotes } from "@/server/actions/invoices";

export function InvoiceNotes({ id, notes }: { id: string; notes: string }) {
  const [value, setValue] = useState(notes);
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardHeader
        title="Note on the invoice"
        description="Printed on the PDF, e.g. a thank-you or a credit note reference."
      />
      <CardBody className="space-y-2">
        <Textarea value={value} onChange={(e) => setValue(e.target.value)} rows={3} />
        <Button
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await updateInvoiceNotes(id, value);
              toast.success("Saved – reload the PDF to see it");
            })
          }
        >
          Save note
        </Button>
      </CardBody>
    </Card>
  );
}
