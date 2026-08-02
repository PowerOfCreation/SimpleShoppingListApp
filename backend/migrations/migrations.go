// Package migrations embeds the SQL migration files so they ship inside the
// compiled binary (no runtime dependency on the source tree or a mounted
// migrations directory).
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
