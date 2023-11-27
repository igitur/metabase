import type { DatasetColumn, RowValue } from "metabase-types/api";
import {
  createOrdersCreatedAtDatasetColumn,
  createOrdersQuantityDatasetColumn,
  createOrdersTotalDatasetColumn,
  createSampleDatabase,
  SAMPLE_DB_ID,
} from "metabase-types/api/mocks/presets";
import { createMockMetadata } from "__support__/metadata";
import * as Lib from "metabase-lib";
import {
  columnFinder,
  createQuery,
  findAggregationOperator,
  findDrillThru,
  queryDrillThru,
} from "metabase-lib/test-helpers";
import { createAggregationColumn } from "./drills-common";

describe("drill-thru/underlying-records", () => {
  const drillType = "drill-thru/underlying-records";
  const defaultQuery = createQueryWithBreakout();
  const stageIndex = 0;
  const aggregationColumn = createAggregationColumn();
  const breakoutColumn = createOrdersCreatedAtDatasetColumn({
    source: "breakout",
  });

  describe("availableDrillThrus", () => {
    it("should allow to drill an aggregated query", () => {
      const { value, row, dimensions } = getCellData(
        aggregationColumn,
        breakoutColumn,
        10,
      );

      const { drillInfo } = findDrillThru(
        drillType,
        defaultQuery,
        stageIndex,
        aggregationColumn,
        value,
        row,
        dimensions,
      );

      expect(drillInfo).toMatchObject({
        type: drillType,
        rowCount: value,
        tableName: "Orders",
      });
    });

    // eslint-disable-next-line jest/no-disabled-tests
    it.skip("should allow to drill via a pivot cell (metabase#35394)", () => {
      const query = createQueryWithMultipleBreakouts();
      const { value, row, dimensions } = getPivotCellData(10);

      const { drillInfo } = findDrillThru(
        drillType,
        query,
        stageIndex,
        undefined,
        undefined,
        row,
        dimensions,
      );

      expect(drillInfo).toMatchObject({
        type: drillType,
        rowCount: value,
        tableName: "Orders",
      });
    });

    // eslint-disable-next-line jest/no-disabled-tests
    it.skip("should allow to drill via a legend item (metabase#35343)", () => {
      const query = createQueryWithMultipleBreakouts();
      const { value, dimensions } = getLegendItemData(10);

      const { drillInfo } = findDrillThru(
        drillType,
        query,
        stageIndex,
        undefined,
        undefined,
        undefined,
        dimensions,
      );

      expect(drillInfo).toMatchObject({
        type: drillType,
        rowCount: value,
        tableName: "Orders",
      });
    });

    // eslint-disable-next-line jest/no-disabled-tests
    it.skip("should use the default row count for aggregations with negative values (metabase#36143)", () => {
      const { value, row, dimensions } = getCellData(
        aggregationColumn,
        breakoutColumn,
        -10,
      );

      const { drillInfo } = findDrillThru(
        drillType,
        defaultQuery,
        stageIndex,
        aggregationColumn,
        value,
        row,
        dimensions,
      );

      expect(drillInfo).toMatchObject({
        type: drillType,
        rowCount: 2,
        tableName: "Orders",
      });
    });

    it("should not allow to drill when there is no aggregation", () => {
      const column = createOrdersTotalDatasetColumn();
      const value = 10;
      const row = [{ col: column, value }];

      const drill = queryDrillThru(
        drillType,
        defaultQuery,
        stageIndex,
        aggregationColumn,
        value,
        row,
      );

      expect(drill).toBeNull();
    });

    it("should not allow to drill with a native query", () => {
      const query = createQuery({
        query: {
          type: "native",
          database: SAMPLE_DB_ID,
          native: { query: "SELECT * FROM ORDERS" },
        },
      });
      const column = createOrdersTotalDatasetColumn({
        id: undefined,
        field_ref: ["field", "TOTAL", { "base-type": "type/Float" }],
      });

      const drill = queryDrillThru(drillType, query, stageIndex, column);

      expect(drill).toBeNull();
    });

    // eslint-disable-next-line jest/no-disabled-tests
    it.skip("should not allow to drill with a non-editable query (metabase#36125)", () => {
      const query = createNotEditableQuery(defaultQuery);
      const { value, row, dimensions } = getCellData(
        aggregationColumn,
        breakoutColumn,
        -10,
      );

      const drill = queryDrillThru(
        drillType,
        query,
        stageIndex,
        aggregationColumn,
        value,
        row,
        dimensions,
      );

      expect(drill).toBeNull();
    });
  });

  describe("drillThru", () => {
    it("should drill via an aggregated cell", () => {
      const { value, row, dimensions } = getCellData(
        aggregationColumn,
        breakoutColumn,
        10,
      );

      const { drill } = findDrillThru(
        drillType,
        defaultQuery,
        stageIndex,
        aggregationColumn,
        value,
        row,
        dimensions,
      );
      const newQuery = Lib.drillThru(defaultQuery, stageIndex, drill);

      expect(Lib.aggregations(newQuery, stageIndex)).toHaveLength(0);
      expect(Lib.filters(newQuery, stageIndex)).toHaveLength(1);
    });

    // eslint-disable-next-line jest/no-disabled-tests
    it.skip("should drill via a pivot cell (metabase#35394)", () => {
      const query = createQueryWithMultipleBreakouts();
      const { row, dimensions } = getPivotCellData(10);

      const { drill } = findDrillThru(
        drillType,
        query,
        stageIndex,
        undefined,
        undefined,
        row,
        dimensions,
      );
      const newQuery = Lib.drillThru(defaultQuery, stageIndex, drill);

      expect(Lib.aggregations(newQuery, stageIndex)).toHaveLength(0);
      expect(Lib.filters(newQuery, stageIndex)).toHaveLength(1);
    });

    // eslint-disable-next-line jest/no-disabled-tests
    it.skip("should drill via a legend item (metabase#35343)", () => {
      const query = createQueryWithMultipleBreakouts();
      const { dimensions } = getLegendItemData(10);

      const { drill } = findDrillThru(
        drillType,
        query,
        stageIndex,
        undefined,
        undefined,
        undefined,
        dimensions,
      );
      const newQuery = Lib.drillThru(defaultQuery, stageIndex, drill);

      expect(Lib.aggregations(newQuery, stageIndex)).toHaveLength(0);
      expect(Lib.filters(newQuery, stageIndex)).toHaveLength(1);
    });
  });
});

function createQueryWithBreakout() {
  const stageIndex = 0;
  const defaultQuery = createQuery();
  const queryWithAggregation = Lib.aggregate(
    defaultQuery,
    stageIndex,
    Lib.aggregationClause(findAggregationOperator(defaultQuery, "count")),
  );
  return Lib.breakout(
    queryWithAggregation,
    stageIndex,
    columnFinder(
      queryWithAggregation,
      Lib.breakoutableColumns(queryWithAggregation, stageIndex),
    )("ORDERS", "CREATED_AT"),
  );
}

function createQueryWithMultipleBreakouts() {
  const query = createQueryWithBreakout();
  return Lib.breakout(
    query,
    -1,
    columnFinder(query, Lib.breakoutableColumns(query, -1))(
      "ORDERS",
      "QUANTITY",
    ),
  );
}

function createNotEditableQuery(query: Lib.Query) {
  const metadata = createMockMetadata({
    databases: [
      createSampleDatabase({
        tables: [],
      }),
    ],
  });

  return createQuery({
    metadata,
    query: Lib.toLegacyQuery(query),
  });
}

function getCellData(
  aggregationColumn: DatasetColumn,
  breakoutColumn: DatasetColumn,
  value: RowValue,
) {
  const row = [
    { key: "Created At", col: breakoutColumn, value: "2020-01-01" },
    { key: "Count", col: aggregationColumn, value },
  ];
  const dimensions = [{ column: breakoutColumn, value }];

  return { value, row, dimensions };
}

function getPivotCellData(value: RowValue) {
  const aggregationColumn = createAggregationColumn();
  const breakoutColumn1 = createOrdersCreatedAtDatasetColumn({
    source: "breakout",
  });
  const breakoutColumn2 = createOrdersQuantityDatasetColumn({
    source: "breakout",
  });

  const row = [
    { col: breakoutColumn1, value: "2020-01-01" },
    { col: breakoutColumn2, value: 0 },
    { col: aggregationColumn, value },
  ];
  const dimensions = [
    { column: breakoutColumn1, value: "2020-01-01" },
    { column: breakoutColumn2, value: 0 },
  ];

  return { value, row, dimensions };
}

function getLegendItemData(value: RowValue) {
  const column = createOrdersQuantityDatasetColumn({ source: "breakout" });
  const dimensions = [{ column, value }];
  return { value, dimensions };
}
