name: Bug report
description: Something is not working as expected
labels: [bug]
body:
  - type: textarea
    id: what-happened
    attributes:
      label: What happened?
      description: Also tell us what you expected to happen instead.
    validations:
      required: true
  - type: textarea
    id: steps
    attributes:
      label: Steps to reproduce
      placeholder: |
        1. Start the API and web app
        2. ...
    validations:
      required: true
  - type: textarea
    id: environment
    attributes:
      label: Environment
      placeholder: OS, browser, Node version, model/endpoint configured
    validations:
      required: true
