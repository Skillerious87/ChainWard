import { ViewLoading } from "@/components/ui/view-loading";

export default function Loading() {
  return <ViewLoading variant="table" title="Loading payout ledger" hint="Reading persisted settlements" />;
}
