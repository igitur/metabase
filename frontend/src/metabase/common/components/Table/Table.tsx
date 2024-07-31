import React from "react";

import { ControlledTable } from "./ControlledTable";

type BaseRow = Record<string, unknown> & { id: number | string };

type ColumnItem = {
  name: string;
  key: string;
};

export type TableProps<Row extends BaseRow> = {
  columns: ColumnItem[];
  rows: Row[];
  rowRenderer: (row: Row) => React.ReactNode;
  tableProps?: React.HTMLAttributes<HTMLTableElement> & { className: string };
};

/**
 * A basic reusable table component that supports client-side sorting by a column
 *
 * @param columns     - an array of objects with name and key properties
 * @param rows        - an array of objects with keys that match the column keys
 * @param rowRenderer - a function that takes a row object and returns a <tr> element
 * @param tableProps  - additional props to pass to the <table> element
 */
export function Table<Row extends BaseRow>({
  columns,
  rows,
  rowRenderer,
  tableProps,
  ...rest
}: TableProps<Row>) {
  const [sortColumn, setSortColumn] = React.useState<string | null>(null);
  const [sortDirection, setSortDirection] = React.useState<"asc" | "desc">(
    "asc",
  );

  const sortedRows = React.useMemo(() => {
    if (sortColumn) {
      return [...rows].sort((a, b) => {
        const aValue = a[sortColumn];
        const bValue = b[sortColumn];
        if (
          aValue === bValue ||
          !isSortableValue(aValue) ||
          !isSortableValue(bValue)
        ) {
          return 0;
        }
        if (sortDirection === "asc") {
          return aValue < bValue ? -1 : 1;
        } else {
          return aValue > bValue ? -1 : 1;
        }
      });
    }
    return rows;
  }, [rows, sortColumn, sortDirection]);

  return (
    <ControlledTable
      rows={sortedRows}
      columns={columns}
      rowRenderer={rowRenderer}
      onSort={({ name, direction }) => {
        setSortColumn(name);
        setSortDirection(direction);
      }}
      tableProps={tableProps}
      sortColumn={
        sortColumn ? { name: sortColumn, direction: sortDirection } : undefined
      }
      {...rest}
    />
  );
}

function isSortableValue(value: unknown): value is string | number {
  return typeof value === "string" || typeof value === "number";
}
