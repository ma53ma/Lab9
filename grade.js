#!/usr/bin/env node

'use strict'

const _ = require('lodash')
const expect = require('chai').expect
const childProcess = require('child-process-promise')
const fs = require('fs-extra')
const path = require('path')
const jsYAML = require('js-yaml')
const mergeDirs = require('merge-dirs').default
const handlebars = require('handlebars')
const moment = require('moment')
const byline = require('byline')

const debug = require('debug')('grade')
const directoryTree = require('directory-tree')

let grade = async () => {
  let result = {
    succeeded: false,
    score: 0
  }

  /*
   * Copy things over from where PL leaves them.
   */
  fs.removeSync('/base/src/test/java')
  fs.removeSync('/base/src/main/java')

  try {
    mergeDirs('/grade/tests/java', '/base/src/test/java', 'overwrite')
    mergeDirs('/grade/student', '/base/src/main/java', 'overwrite')
    // This directory may not exist if we are using the default configuration
    try {
      mergeDirs('/grade/tests/config', '/base/src/test/config', 'overwrite')
    } catch (err) { }
  } catch (err) {
    result.message = `Failed copying files: ${ err }`
    return result
  }

  /*
   * Grab configuration information for sanity checking.
   */
  try {
    var configuration = jsYAML.safeLoad(await fs.readFile('/base/config/grade.yaml'))
    expect(configuration.grading).to.have.property('run')
    expect(configuration.grading).to.have.property('timeout')
  } catch (err) {
    result.message = `Bad configuration file: ${ err }`
    return result
  }
  debug(JSON.stringify(configuration, null, 2))

  let gradeFile = path.join('/base/', 'grade.json')
  let gradingCommandTemplate = handlebars.compile(configuration.grading.run)
  let gradingCommand = gradingCommandTemplate({ gradeFile: gradeFile })
  debug(gradingCommand)

  /*
   * Run the command and capture output.
   */
  let started = moment(), output = []
  let execution = childProcess.spawn(gradingCommand, [], {
    cwd: '/base/', shell: true, encoding: 'utf8',
  })
  execution.childProcess.on('error', err => {
    result.message = `Spawn failed: ${ err }`
    return result
  })
  let stdoutStream = byline(execution.childProcess.stdout, {
    keepEmptyLines: true,
    encoding: 'utf8'
  })
  let stderrStream = byline(execution.childProcess.stderr, {
    keepEmptyLines: true,
    encoding: 'utf8'
  })
  stdoutStream.on('data', data => {
    output.push({
      type: 'stdout',
      data: data.toString(),
      delta: moment.duration(moment().diff(started)).toISOString()
    })
  })
  stderrStream.on('data', data => {
    output.push({
      type: 'stderr',
      data: data.toString(),
      delta: moment.duration(moment().diff(started)).toISOString()
    })
  })
  let executionTimer, timeout = false
  try {
    await execution.progress(() => {
      let timeout = moment.duration(configuration.grading.timeout).asSeconds()
      executionTimer = setTimeout(() => {
        timeout = true
        execution.childProcess.kill()
      }, timeout * 1000)
    })
  } catch (err) { }

  /*
   * Clean up output.
   */
  result.output = _(output)
    .filter(line => {
      return !(_.find(configuration.grading.ignoreOutput, regexp => {
        return new RegExp(regexp).test(line.data)
      }))
    })
    .map(line => {
      return line.data
    })
    .value().join('\n').trim()

  try {
    clearTimeout(executionTimer)
  } catch (err) { }

  try {
    let gradeContent = await fs.readFile(gradeFile)
    var gradeData = JSON.parse(gradeContent.toString())
    debug(JSON.stringify(gradeData, null, 2))

    expect(gradeData).to.have.property('totalScore')
    expect(gradeData.totalScore).to.be.a('number')

    result.score = gradeData.totalScore / configuration.scoring.max
    expect(result.score).to.be.a('number')
    expect(result.score).to.be.at.least(0)
    expect(result.score).to.be.at.most(1)

  } catch (err) {
    result.message = `Grading produced no output file: ${ err }`
    return result
  }

  result.succeeded = true
  return result
}

Promise.resolve().then(async () => {
  try {
    var result = await grade()
  } catch (err) {
    console.log(err)
    return
  }
  debug(JSON.stringify(result, null, 2))

  /*
   * Write out results.
   */
  fs.ensureDirSync('/grade/results')
  fs.writeFileSync('/grade/results/results.json', JSON.stringify(result, null, 2))
})
