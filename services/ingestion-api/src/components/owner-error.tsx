import { CircleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function OwnerError({ message }: Readonly<{ message: string | undefined }>) {
  if (message === undefined || message.length === 0) return null;
  return (
    <Alert variant="destructive">
      <CircleAlertIcon aria-hidden="true" />
      <AlertTitle>Could not continue</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
