import { Api } from "metabase/api";
import type { Card } from "metabase-types/api";

type invalidCard = Card & {
  errors: {
    "inactive-fields": any[];
  };
};
export type invalidCardResponse = {
  data: invalidCard[];
  total: number;
  limit: number;
  offset: number;
};

export const queryValidationAPI = Api.injectEndpoints({
  endpoints: builder => ({
    getInvalidCards: builder.query<invalidCardResponse, void>({
      query: () => ({
        method: "GET",
        url: "/api/ee/query-field-validation/invalid-cards",
      }),
    }),
  }),
});

export const { useGetInvalidCardsQuery } = queryValidationAPI;
