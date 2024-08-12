import { t } from "ttag";

import type { CardError } from "metabase-enterprise/api/query-validation";

export const formatErrorString = (errors: CardError[]) => {
  const messages = [];

  const inactiveFields = errors.filter(
    error => error.type === "inactive-field",
  );

  const unknownFields = errors.filter(error => error.type === "unknown-field");

  if (inactiveFields.length > 0) {
    messages.push(
      t`Field ${inactiveFields
        .map(field => field.field)
        .join(", ")} is inactive`,
    );
  }

  if (unknownFields.length > 0) {
    messages.push(
      t`Field ${unknownFields.map(field => field.field).join(", ")} is unknown`,
    );
  }

  if (messages.length > 0) {
    return messages.join(", ");
  } else {
    return "I don't know what's wrong, but it's broken";
  }
};
