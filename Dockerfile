# First stage
FROM node:20-alpine as builder
ENV NODE_ENV=production

WORKDIR /rallypoint
# Copy the whole repository to the image, *except* the stuff marked in the `.dockerignore` file
COPY . .
RUN yarn

# Second stage
FROM node:20-alpine
ENV NODE_ENV=production

WORKDIR /home/node/rallypoint
USER node

COPY --chown=node:node --from=builder /rallypoint .

# rally-point protocol port
EXPOSE 14098/udp

CMD node ./index.js
