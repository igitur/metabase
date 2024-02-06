import { jt, t } from "ttag";
import type { ChangeEvent, ReactNode } from "react";
import { Divider, SegmentedControl, Stack, Switch, Text } from "metabase/ui";
import { useSelector } from "metabase/lib/redux";
import {
  getDocsUrl,
  getSetting,
  getUpgradeUrl,
} from "metabase/selectors/settings";
import ExternalLink from "metabase/core/components/ExternalLink";
import Select from "metabase/core/components/Select";
import { useUniqueId } from "metabase/hooks/use-unique-id";
import { color } from "metabase/lib/colors";
import { getCanWhitelabel } from "metabase/selectors/whitelabel";
import type {
  EmbeddingDisplayOptions,
  EmbedResourceType,
} from "metabase/public/lib/types";
import { getPlan } from "metabase/common/utils/plan";

import { PreviewModeSelector } from "./PreviewModeSelector";
import type { ActivePreviewPane } from "./types";
import PreviewPane from "./PreviewPane";
import {
  DisplayOptionSection,
  SettingsTabLayout,
} from "./StaticEmbedSetupPane.styled";
import { StaticEmbedSetupPaneSettingsContentSection } from "./StaticEmbedSetupPaneSettingsContentSection";

const THEME_OPTIONS = [
  { label: t`Light`, value: "light" },
  { label: t`Dark`, value: "night" },
  { label: t`Transparent`, value: "transparent" },
] as const;
type ThemeOptions = typeof THEME_OPTIONS[number]["value"];

export interface AppearanceSettingsProps {
  activePane: ActivePreviewPane;

  resourceType: EmbedResourceType;
  iframeUrl: string;
  displayOptions: EmbeddingDisplayOptions;
  serverEmbedCodeSlot: ReactNode;

  onChangePane: (pane: ActivePreviewPane) => void;
  onChangeDisplayOptions: (displayOptions: EmbeddingDisplayOptions) => void;
}

export const AppearanceSettings = ({
  activePane,
  resourceType,
  iframeUrl,
  displayOptions,
  serverEmbedCodeSlot,

  onChangePane,
  onChangeDisplayOptions,
}: AppearanceSettingsProps): JSX.Element => {
  const docsUrl = useSelector(state =>
    // eslint-disable-next-line no-unconditional-metabase-links-render -- Only appear to admins
    getDocsUrl(state, {
      page: "embedding/static-embedding",
    }),
  );
  const upgradePageUrl = useSelector(state =>
    getUpgradeUrl(state, { utm_media: "static-embed-settings-appearance" }),
  );
  const plan = useSelector(state =>
    getPlan(getSetting(state, "token-features")),
  );
  const canWhitelabel = useSelector(getCanWhitelabel);
  const availableFonts = useSelector(state =>
    getSetting(state, "available-fonts"),
  );
  const utmTags = `?utm_source=${plan}&utm_media=static-embed-settings-appearance`;

  const fontControlLabelId = useUniqueId("display-option");
  const downloadDataId = useUniqueId("download-data");

  return (
    <SettingsTabLayout
      settingsSlot={
        <>
          <StaticEmbedSetupPaneSettingsContentSection
            title={t`Customizing your embed’s appearance`}
          >
            <Text>{jt`These cosmetic options requiring changing the server code. You can play around with and preview the options here, and check out the ${(
              <ExternalLink
                key="doc"
                href={`${docsUrl}${utmTags}#customizing-the-appearance-of-static-embeds`}
              >{t`documentation`}</ExternalLink>
            )} for more.`}</Text>
          </StaticEmbedSetupPaneSettingsContentSection>
          <StaticEmbedSetupPaneSettingsContentSection
            title={t`Playing with appearance options`}
            mt="2rem"
          >
            <Stack spacing="1rem">
              <DisplayOptionSection title={t`Background`}>
                <SegmentedControl
                  value={displayOptions.theme}
                  // `data` type is required to be mutable.
                  data={[...THEME_OPTIONS]}
                  fullWidth
                  bg={color("bg-light")}
                  onChange={(value: ThemeOptions) => {
                    onChangeDisplayOptions({
                      ...displayOptions,
                      theme: value,
                    });
                  }}
                />
              </DisplayOptionSection>

              <Switch
                label={getTitleLabel(resourceType)}
                labelPosition="left"
                size="sm"
                variant="stretch"
                checked={displayOptions.titled}
                onChange={e =>
                  onChangeDisplayOptions({
                    ...displayOptions,
                    titled: e.target.checked,
                  })
                }
              />

              <Switch
                label={t`Border`}
                labelPosition="left"
                size="sm"
                variant="stretch"
                checked={displayOptions.bordered}
                onChange={e =>
                  onChangeDisplayOptions({
                    ...displayOptions,
                    bordered: e.target.checked,
                  })
                }
              />

              <DisplayOptionSection
                title={t`Font`}
                titleId={fontControlLabelId}
              >
                {canWhitelabel ? (
                  <Select
                    value={displayOptions.font}
                    options={[
                      {
                        name: t`Use instance font`,
                        value: null,
                      },
                      ...availableFonts?.map(font => ({
                        name: font,
                        value: font,
                      })),
                    ]}
                    buttonProps={{
                      "aria-labelledby": fontControlLabelId,
                    }}
                    onChange={(e: ChangeEvent<HTMLSelectElement>) => {
                      onChangeDisplayOptions({
                        ...displayOptions,
                        font: e.target.value,
                      });
                    }}
                  />
                ) : (
                  <Text>{jt`You can change the font with ${(
                    <ExternalLink
                      key="fontPlan"
                      href={upgradePageUrl}
                    >{t`a paid plan`}</ExternalLink>
                  )}.`}</Text>
                )}
              </DisplayOptionSection>

              {canWhitelabel && resourceType === "question" && (
                // We only show the "Download Data" toggle if the users are pro/enterprise
                // and they're sharing a question metabase#23477
                <DisplayOptionSection
                  title={t`Download data`}
                  titleId={downloadDataId}
                >
                  <Switch
                    aria-labelledby={downloadDataId}
                    label={t`Enable users to download data from this embed`}
                    labelPosition="left"
                    size="sm"
                    variant="stretch"
                    checked={!displayOptions.hide_download_button}
                    onChange={e =>
                      onChangeDisplayOptions({
                        ...displayOptions,
                        hide_download_button: !e.target.checked,
                      })
                    }
                  />
                </DisplayOptionSection>
              )}
            </Stack>
          </StaticEmbedSetupPaneSettingsContentSection>
          {!canWhitelabel && (
            <>
              <Divider my="2rem" />
              <StaticEmbedSetupPaneSettingsContentSection
                title={t`Removing the “Powered by Metabase” banner`}
              >
                <Text>{jt`This banner appears on all static embeds created with the Metabase open source version. You’ll need to upgrade to ${(
                  <ExternalLink
                    key="bannerPlan"
                    href={upgradePageUrl}
                  >{t`a paid plan`}</ExternalLink>
                )} to remove the banner.`}</Text>
              </StaticEmbedSetupPaneSettingsContentSection>
            </>
          )}
        </>
      }
      previewSlot={
        <>
          <PreviewModeSelector value={activePane} onChange={onChangePane} />

          {activePane === "preview" ? (
            <PreviewPane
              className="flex-full"
              previewUrl={iframeUrl}
              isTransparent={displayOptions.theme === "transparent"}
            />
          ) : activePane === "code" ? (
            serverEmbedCodeSlot
          ) : null}
        </>
      }
    />
  );
};

function getTitleLabel(resourceType: EmbedResourceType) {
  if (resourceType === "dashboard") {
    return t`Dashboard title`;
  }

  if (resourceType === "question") {
    return t`Question title`;
  }

  return null;
}
