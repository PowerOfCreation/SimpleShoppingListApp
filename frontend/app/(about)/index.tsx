import { compareReleaseVersions } from "@/utils/release-version"
import React, { useState } from "react"
import { FlatList, Linking, StyleSheet, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"
import * as Application from "expo-application"
import Constants from "expo-constants"
import { RELEASES_URL } from "@/api/releases/releases"
import { PrimaryButton } from "@/components/PrimaryButton"
import { ThemedText } from "@/components/ThemedText"
import { useFrontendReleases } from "@/hooks/useFrontendReleases"
import { useThemeColor } from "@/hooks/useThemeColor"

export default function AboutScreen() {
  const { releases, loading, error, refresh } = useFrontendReleases()
  const [linkError, setLinkError] = useState<string | null>(null)
  const backgroundColor = useThemeColor({}, "background")
  const surface = useThemeColor({}, "surface")
  const secondary = useThemeColor({}, "textSecondary")
  const releaseVersion = Constants.expoConfig?.extra?.releaseVersion
  const version =
    (typeof releaseVersion === "string" && releaseVersion) ||
    Application.nativeApplicationVersion ||
    Constants.expoConfig?.version ||
    "Unknown"
  const build = Application.nativeBuildVersion

  async function openRelease(tag: string) {
    try {
      setLinkError(null)
      await Linking.openURL(`${RELEASES_URL}/tag/${encodeURIComponent(tag)}`)
    } catch {
      setLinkError("Could not open GitHub. Please try again.")
    }
  }

  async function openOpenFoodFacts() {
    try {
      setLinkError(null)
      await Linking.openURL("https://world.openfoodfacts.org/data")
    } catch {
      setLinkError("Could not open the link. Please try again.")
    }
  }

  return (
    <SafeAreaView
      edges={["bottom"]}
      style={[styles.container, { backgroundColor }]}
    >
      <FlatList
        data={releases.filter((release) => {
          const comparison = compareReleaseVersions(release.tag_name, version)
          return comparison !== null && comparison >= 0
        })}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <ThemedText type="title">ShoList</ThemedText>
            <ThemedText>
              Version {version}
              {build ? ` (build ${build})` : ""}
            </ThemedText>
            <ThemedText style={{ color: secondary }}>
              Your shopping lists, available offline.
            </ThemedText>
            <ThemedText
              style={{ color: secondary }}
              onPress={() => void openOpenFoodFacts()}
            >
              Category suggestions use data from Open Food Facts, licensed under
              the Open Database License (ODbL).
            </ThemedText>
            <ThemedText type="subtitle">Changelog</ThemedText>
            <ThemedText style={{ color: secondary }}>
              Frontend releases from your installed version onward, including
              pre-releases. Latest first.
            </ThemedText>
            {error ? (
              <ThemedText accessibilityRole="alert">{error}</ThemedText>
            ) : null}
            {linkError ? (
              <ThemedText accessibilityRole="alert">{linkError}</ThemedText>
            ) : null}
            <PrimaryButton
              label="Refresh release notes"
              loading={loading}
              onPress={refresh}
            />
          </View>
        }
        ListEmptyComponent={
          !loading && !error ? (
            <ThemedText>
              No releases available for your installed version or newer.
            </ThemedText>
          ) : null
        }
        renderItem={({ item }) => (
          <View style={[styles.release, { backgroundColor: surface }]}>
            <ThemedText type="subtitle">
              {item.name || item.tag_name}
            </ThemedText>
            <ThemedText style={{ color: secondary }}>
              {new Date(item.published_at).toLocaleDateString()}
              {item.prerelease ? " · Pre-release" : ""}
            </ThemedText>
            <ThemedText selectable>
              {item.body?.trim() || "No release notes provided."}
            </ThemedText>
            <PrimaryButton
              label="View on GitHub"
              onPress={() => void openRelease(item.tag_name)}
            />
          </View>
        )}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 20, gap: 16 },
  header: { gap: 16, marginBottom: 20 },
  release: { padding: 16, borderRadius: 12, gap: 12 },
})
