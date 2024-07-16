import { useMemo } from "react";
import { Link } from "react-router";
import { t } from "ttag";

import { StyledTable } from "metabase/common/components/Table";
import { Ellipsified } from "metabase/core/components/Ellipsified";
import CS from "metabase/css/core/index.css";
import { formatDateTimeWithUnit } from "metabase/lib/formatting/date";
import * as Urls from "metabase/lib/urls";
import { Title, Box, Icon } from "metabase/ui";
import { useGetInvalidCardsQuery } from "metabase-enterprise/api/query-validation";

const COLUMNS = [
  { name: "Question", key: "name" },
  { name: "Error", key: "error" },
  { name: "Collection", key: "collection" },
  { name: "Created by", key: "owner" },
  { name: "Last edited", key: "last-edited" },
];

export const QueryValidator = () => {
  const { data: invalidCards } = useGetInvalidCardsQuery();

  const processedData = useMemo(
    () =>
      invalidCards?.data.map(d => ({
        name: d.name,
        created_by: d.creator?.common_name,
        collection: d.collection?.name,
        error: `Field ${d.errors["inactive-fields"]
          .map(f => f.field)
          .join(", ")} is invalid`,
        last_edited_at: d.updated_at,
        id: d.id,
        icon: d.display,
        link: Urls.question(d),
      })) || [],
    [invalidCards],
  );

  return (
    <Box>
      <Title mb="1rem">{t`Questions with invalid references`}</Title>

      <StyledTable
        columns={COLUMNS}
        rows={processedData}
        rowRenderer={row => <QueryValidatorRow row={row} />}
      ></StyledTable>
    </Box>
  );
};

const QueryValidatorRow = ({ row }: { row: any }) => {
  return (
    <tr>
      <td className={`${CS.textBold} ${CS.py2}`}>
        <Link to={row.link}>
          <Ellipsified>
            {row.icon && (
              <Icon
                name={row.icon}
                style={{ verticalAlign: "bottom", marginInlineEnd: "0.25rem" }}
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
