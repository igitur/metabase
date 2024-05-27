import { css } from "@emotion/react";
import styled from "@emotion/styled";

import { Icon } from "metabase/ui";

import SidebarLink from "./SidebarLink";

export const DragIcon = styled(Icon)`
  left: 2px;
  opacity: 0;
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  cursor: grab;
`;

export const StyledSidebarLink = styled(SidebarLink)<{ isDragging: boolean }>`
  position: relative;

  &:hover {
    ${DragIcon} {
      opacity: 0.3;
    }
  }

  ${({ isDragging, theme }) =>
    isDragging &&
    css`
      pointer-events: none;
      &:hover {
        background: ${theme.fn.themeColor("bg-white")};

        ${SidebarLink.Icon}, ${DragIcon} {
          color: ${theme.fn.themeColor("brand-light")} !important;
        }

        ${SidebarLink.RightElement} {
          opacity: 0;
        }
      }
    `}
`;
