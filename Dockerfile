FROM openjdk:9.0.1-jdk-slim

MAINTAINER Geoffrey Challen <challen@illinois.edu>

#ENV GRADLE_OPTS="-XaddExports:jdk.compiler/com.sun.tools.javac.file=ALL-UNNAMED"

COPY gradle /base/gradle
COPY gradle.properties /base/gradle.properties
COPY build.gradle /base/build.gradle
COPY src /base/src
COPY config /base/config
COPY gradlew /base/gradlew
RUN cd /base && ./gradlew grade

RUN apt-get update && \
    apt-get install -y curl gnupg2 && \
    bash -c "curl -sL https://deb.nodesource.com/setup_8.x | bash -" && \
    apt-get install -y nodejs && \
    apt-get autoremove -y --purge && \
    rm -rf /var/lib/apt/lists/*

COPY package.json /base/package.json
COPY package-lock.json /base/package-lock.json
RUN cd /base && npm i -s

COPY . /base

WORKDIR /base
ENTRYPOINT ["node", "grade.js"]
