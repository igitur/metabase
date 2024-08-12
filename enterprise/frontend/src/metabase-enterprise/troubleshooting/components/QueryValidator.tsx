import { useMemo, useState } from "react";
import { Link } from "react-router";
import { t } from "ttag";
import _ from "underscore";

import {
  CollectionPickerModal,
  type CollectionPickerValueItem,
} from "metabase/common/components/CollectionPicker";
import { StyledControlledTable } from "metabase/common/components/Table";
import { Ellipsified } from "metabase/core/components/Ellipsified";
import CS from "metabase/css/core/index.css";
import { usePagination } from "metabase/hooks/use-pagination";
import { formatDateTimeWithUnit } from "metabase/lib/formatting/date";
import * as Urls from "metabase/lib/urls";
import { Title, Box, Icon, Flex, Button } from "metabase/ui";
import { useGetInvalidCardsQuery } from "metabase-enterprise/api/query-validation";
import type { RegularCollectionId } from "metabase-types/api";

import { formatErrorString } from "../utils";

const COLUMNS = [
  { name: "Question", key: "name", sortable: true },
  { name: "Error", key: "error" },
  { name: "Collection", key: "collection", sortable: true },
  { name: "Created by", key: "created_by", sortable: true },
  { name: "Last edited", key: "last_edited_at", sortable: true },
];

const PAGE_SIZE = 15;

export const QueryValidator = () => {
  const [sortColumn, setSortColumn] = useState<string>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [collectionPickerOpen, setCollectionPickerOpen] = useState(false);
  const [collectionId, setCollectionId] = useState<
    RegularCollectionId | undefined
  >(undefined);

  const { setPage, page } = usePagination();

  const { data: invalidCards } = useGetInvalidCardsQuery({
    sort_column: sortColumn,
    sort_direction: sortDirection,
    limit: PAGE_SIZE,
    offset: PAGE_SIZE * page,
    collection_id: collectionId,
  });

  const handleCollectionChange = (collection: CollectionPickerValueItem) => {
    if (collection.id === "root") {
      setCollectionId(undefined);
    } else {
      setCollectionId(collection.id);
    }
    setCollectionPickerOpen(false);
  };

  const processedData = useMemo(
    () =>
      invalidCards?.data.map(d => ({
        name: d.name,
        created_by: d.creator?.common_name,
        collection: d.collection?.name || "root",
        error: formatErrorString(d.errors),
        last_edited_at: d.updated_at,
        id: _.uniqueId("broken_card"),
        icon: d.display,
        link: Urls.question(d),
      })) || [],
    [invalidCards],
  );

  return (
    <>
      <Box>
        <Flex mb="2rem" justify="space-between" align="center">
          <Title>{t`Questions with invalid references`}</Title>
          <Button
            rightIcon={<Icon name="chevrondown" size={14} />}
            styles={{
              inner: {
                justifyContent: "space-between",
                color: "var(--mb-color-text-light)",
                fontWeight: "normal",
              },
              root: { "&:active": { transform: "none" } },
              rightIcon: {
                marginLeft: "100px",
              },
            }}
            onClick={() => setCollectionPickerOpen(true)}
          >
            {t`All Collections`}
          </Button>
        </Flex>
        <StyledControlledTable
          columns={COLUMNS}
          rows={processedData}
          rowRenderer={row => <QueryValidatorRow row={row} />}
          sortColumn={{ name: sortColumn, direction: sortDirection }}
          onSort={({ name, direction }) => {
            setSortColumn(name);
            setSortDirection(direction);
            setPage(0);
          }}
          onPageChange={setPage}
          page={page}
          totalItems={invalidCards?.total}
        ></StyledControlledTable>
      </Box>
      {collectionPickerOpen && (
        <CollectionPickerModal
          title={t`Select a collection`}
          value={{ id: collectionId, model: "collection" }}
          onChange={handleCollectionChange}
          onClose={() => setCollectionPickerOpen(false)}
          options={{
            hasRecents: false,
            showRootCollection: true,
            showPersonalCollections: true,
          }}
        />
      )}
    </>
  );
};

const QueryValidatorRow = ({ row }: { row: any }) => {
  return (
    <tr>
      <td className={`${CS.textBold} ${CS.py2}`}>
        <Link to={row.link}>
          <Ellipsified style={{ color: "var(--mb-color-brand)" }}>
            {row.icon && (
              <Icon
                name={row.icon}
                style={{ verticalAlign: "bottom", marginInlineEnd: "0.75rem" }}
              />
            )}
            {row.name}
          </Ellipsified>
        </Link>
      </td>
      <td>{row.error}</td>
      <td>{row.collection}</td>
      <td>{row.created_by}</td>
      <td>{formatDateTimeWithUnit(row.last_edited_at, "day")}</td>
    </tr>
  );
};
