import { css } from "@emotion/react";
import styled from "@emotion/styled";

import { color } from "metabase/lib/colors";

export const ChunkyListItem = styled.button<{
  isSelected?: boolean;
  isLast?: boolean;
}>`
  padding: 1.5rem;
  cursor: pointer;

  background-color: ${({ isSelected }) =>
    isSelected ? color("brand") : "white"};

  color: ${({ isSelected }) =>
    isSelected ? color("white") : color("text-dark")};

  &:hover {
    ${({ isSelected, theme }) =>
      !isSelected
        ? css`
            background-color: ${theme.fn.themeColor("brand-lighter")};
            color: ${theme.fn.themeColor("text-dark")};
          `
        : ""}
  }

  ${({ isLast, theme }) =>
    !isLast
      ? css`
          border-bottom: 1px solid ${theme.fn.themeColor("border")};
        `
      : ""};

  display: flex;
  gap: 1rem;
  justify-content: space-between;
  align-items: center;
  width: 100%;
`;

export const ChunkyList = styled.div`
  border: 1px solid ${() => color("border")};
  border-radius: 0.5rem;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;
