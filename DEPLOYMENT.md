# Deployment

## On Fly

Commands to setup a new location, after copying/updating a toml file:

```sh
flyctl apps create rally-point-REGION
flyctl ips allocate-v4 -c fly-REGION.toml --yes
flyctl scale count 1 -c fly-REGION.toml --yes
flyctl secrets set -c fly-REGION.toml SECRET=foo-bar-baz-really-secret-string
flyctl deploy -c fly-REGION.toml
```
