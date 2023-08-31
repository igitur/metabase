/* eslint-disable react/prop-types */
import { t } from "ttag";
import type { SearchSidebarFilterComponent } from "metabase/search/types";
import { Text } from "metabase/ui";
import { getTranslatedEntityName } from "metabase/nav/utils";

export const TypeFilterDisplay: SearchSidebarFilterComponent<"type">["DisplayComponent"] =
  ({ value }) => {
    let titleText = "";
    if (value.length === 1) {
      titleText = getTranslatedEntityName(value[0]) ?? t`1 type selected`;
    } else {
      titleText = value.length + t` types selected`;
    }
    return (
      <Text c="inherit" weight={700}>
        {titleText}
      </Text>
    );
  };
