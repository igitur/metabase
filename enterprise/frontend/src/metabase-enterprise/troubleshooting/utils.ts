import { t } from "ttag";

import type { CardError } from "metabase-enterprise/api/query-validation";

export const formatErrorString = (errors: CardError[]) => {
  const inactiveFields = errors.filter(
    error => error.type === "inactive-field",
  );

  if (inactiveFields.length > 0) {
    return t`Field ${inactiveFields
      .map(field => field.field)
      .join(", ")} is inactive`;
  }
};
