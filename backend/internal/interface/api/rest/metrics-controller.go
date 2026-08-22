package rest

import (
	"github.com/labstack/echo/v4"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

type MetricsController struct {
	registry *prometheus.Registry
}

// NewMetricsController exposes Prometheus-format metrics on an
// unauthenticated GET /metrics route (scrapers carry no Keycloak token,
// same reasoning as /healthz). The registry only holds the standard Go
// runtime/process collectors for now - a deliberately empty foundation
// future PRs register domain-specific collectors against.
func NewMetricsController(e *echo.Echo) *MetricsController {
	registry := prometheus.NewRegistry()
	registry.MustRegister(
		collectors.NewGoCollector(),
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
	)

	controller := &MetricsController{registry: registry}
	e.GET("/metrics", echo.WrapHandler(promhttp.HandlerFor(registry, promhttp.HandlerOpts{})))
	return controller
}
