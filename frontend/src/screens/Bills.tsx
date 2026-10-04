import { useState } from "react";
import { api } from "../api/client";
import { BillReportView } from "../components/BillReportView";
import { Alert, Card, Loading } from "../components/ui";
import { describeError } from "../lib/errors";
import { currentBankMonth, formatMonth, shiftMonth } from "../lib/format";
import { useLoad } from "../lib/useLoad";
import { useSession } from "../session";

export function Bills() {
  const { bankVersion } = useSession();
  const thisMonth = currentBankMonth();
  const [month, setMonth] = useState(thisMonth);
  const report = useLoad(() => api.billReport(month), [month, bankVersion]);
  const transactions = useLoad(() => api.transactions(), [bankVersion]);

  return (
    <div className="page">
      <h1 className="page-title">Monthly bills</h1>
      <Card
        title={formatMonth(month)}
        actions={
          <div className="month-picker">
            <button type="button" className="btn btn-sm" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month">
              ‹
            </button>
            <input
              type="month"
              value={month}
              max={thisMonth}
              onChange={(e) => /^\d{4}-\d{2}$/.test(e.target.value) && setMonth(e.target.value)}
              aria-label="Month"
            />
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => setMonth(shiftMonth(month, 1))}
              disabled={month >= thisMonth}
              aria-label="Next month"
            >
              ›
            </button>
          </div>
        }
      >
        {report.loading && !report.data ? (
          <Loading />
        ) : report.error ? (
          <Alert tone="danger">{describeError(report.error)}</Alert>
        ) : report.data ? (
          <BillReportView report={report.data} transactions={transactions.data?.transactions} />
        ) : null}
        <p className="small muted">Months follow the bank's Asia/Shanghai calendar.</p>
      </Card>
    </div>
  );
}
