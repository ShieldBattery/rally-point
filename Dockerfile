FROM node:16-alpine as builder
ENV NODE_ENV=production

RUN npm install -g npm@7.x.x

# Set the working directory to the home directory of the `node` user
WORKDIR /home/node/rallypoint

RUN chown node:node .

# Copy the whole repository to the image, *except* the stuff marked in the `.dockerignore` file
COPY --chown=node:node . .

# Set the user to `node` for any subsequent `RUN` and `CMD` instructions
USER node

RUN npm install

# rally-point protocol port
EXPOSE 14098/udp

CMD node ./index.js
