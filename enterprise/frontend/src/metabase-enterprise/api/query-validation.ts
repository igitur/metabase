import { Api } from "metabase/api";
import type {
  Card,
  PaginationRequest,
  PaginationResponse,
} from "metabase-types/api";

type invalidCard = Card & {
  errors: {
    "inactive-fields": any[];
  };
};
export type invalidCardResponse = {
  data: invalidCard[];
} & PaginationResponse;

export type invalidCardRequest = {
  sort_direction?: "asc" | "desc";
  sort_column?: string;
} & PaginationRequest;

export const queryValidationAPI = Api.injectEndpoints({
  endpoints: builder => ({
    getInvalidCards: builder.query<invalidCardResponse, invalidCardRequest>({
      query: params => ({
        method: "GET",
        url: "/api/ee/query-field-validation/invalid-cards",
        params,
      }),
    }),
  }),
});

export const { useGetInvalidCardsQuery } = queryValidationAPI;
