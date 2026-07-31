import React from "react"
import { ActivityIndicator, StyleSheet, View } from "react-native"
import { SafeAreaView } from "react-native-safe-area-context"

import { isAuthConfigured } from "@/api/auth/config"
import { useAuth } from "@/api/auth/AuthProvider"
import { PrimaryButton } from "@/components/PrimaryButton"
import { ThemedText } from "@/components/ThemedText"
import { useThemeColor } from "@/hooks/useThemeColor"

export default function AccountScreen() {
  const { status, user, error, busy, login, logout } = useAuth()
  const backgroundColor = useThemeColor({}, "background")
  const secondaryColor = useThemeColor({}, "textSecondary")
  const dangerColor = useThemeColor({}, "danger")
  const dividerColor = useThemeColor({}, "divider")

  const configured = isAuthConfigured()

  return (
    <SafeAreaView
      testID="account-screen"
      edges={["bottom"]}
      style={[styles.container, { backgroundColor }]}
    >
      <View style={styles.content}>
        {status === "loading" ? (
          <ActivityIndicator testID="account-loading" size="large" />
        ) : status === "signedIn" ? (
          <>
            <ThemedText type="subtitle">Signed in</ThemedText>
            <ThemedText testID="account-user" style={styles.userName}>
              {user?.name ?? user?.username ?? "Unknown user"}
            </ThemedText>
            {user?.email ? (
              <ThemedText style={[styles.hint, { color: secondaryColor }]}>
                {user.email}
              </ThemedText>
            ) : null}
            <View style={[styles.divider, { backgroundColor: dividerColor }]} />
            <PrimaryButton
              testID="account-logout"
              label="Sign out"
              variant="danger"
              loading={busy}
              onPress={logout}
            />
          </>
        ) : (
          <>
            <ThemedText type="subtitle">Not signed in</ThemedText>
            <ThemedText style={[styles.hint, { color: secondaryColor }]}>
              Your shopping lists are stored on this device. Signing in is
              optional and does not change how the app works today.
            </ThemedText>
            <View style={[styles.divider, { backgroundColor: dividerColor }]} />
            {configured ? (
              <PrimaryButton
                testID="account-login"
                label="Sign in with Keycloak"
                loading={busy}
                onPress={login}
              />
            ) : (
              <ThemedText
                testID="account-not-configured"
                style={[styles.hint, { color: secondaryColor }]}
              >
                Login is not configured. Set EXPO_PUBLIC_KEYCLOAK_ISSUER and
                EXPO_PUBLIC_KEYCLOAK_CLIENT_ID to enable it.
              </ThemedText>
            )}
          </>
        )}

        {error ? (
          <ThemedText
            testID="account-error"
            style={[styles.error, { color: dangerColor }]}
          >
            {error}
          </ThemedText>
        ) : null}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 20,
    gap: 8,
  },
  userName: {
    fontSize: 18,
    fontWeight: "600",
  },
  hint: {
    fontSize: 14,
    lineHeight: 20,
  },
  divider: {
    height: 1,
    marginVertical: 12,
  },
  error: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 12,
  },
})
