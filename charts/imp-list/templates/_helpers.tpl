{{/*
Expand the name of the chart.
*/}}
{{- define "imp-list.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "imp-list.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "imp-list.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Fully qualified name of one component's resources, e.g. "<release>-backend".
Call with (dict "root" $ "component" "backend").
*/}}
{{- define "imp-list.componentFullname" -}}
{{- printf "%s-%s" (include "imp-list.fullname" .root) .component | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Labels that don't select anything — safe to put on a Pod that must NOT
become a Service endpoint (e.g. a test hook), unlike imp-list.selectorLabels.
Call with (dict "root" $ "component" "backend" "version" $.Values.backend.image.tag).
*/}}
{{- define "imp-list.commonLabels" -}}
helm.sh/chart: {{ include "imp-list.chart" .root }}
app.kubernetes.io/version: {{ .version | default .root.Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .root.Release.Service }}
app.kubernetes.io/part-of: imp-list
{{- end }}

{{- define "imp-list.labels" -}}
{{ include "imp-list.commonLabels" . }}
{{ include "imp-list.selectorLabels" . }}
{{- end }}

{{/*
Selecting labels — app.kubernetes.io/component is part of this so that
multiple components' Deployments/Services never overlap selectors.
Call with (dict "root" $ "component" "backend").
*/}}
{{- define "imp-list.selectorLabels" -}}
app.kubernetes.io/name: {{ include "imp-list.name" .root }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{/*
Name of the Secret the backend Deployment/test hook should read credentials
from — either a user-supplied existingSecret, or the one this chart renders
itself.
*/}}
{{- define "imp-list.backend.secretName" -}}
{{- if .Values.backend.secret.existingSecret }}
{{- .Values.backend.secret.existingSecret }}
{{- else }}
{{- include "imp-list.componentFullname" (dict "root" . "component" "backend") }}
{{- end }}
{{- end }}
