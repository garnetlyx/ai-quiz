name: Feature request
description: Suggest an idea for this project
labels: [enhancement]
body:
  - type: textarea
    id: problem
    attributes:
      label: Problem
      description: What is missing or painful today?
    validations:
      required: true
  - type: textarea
    id: solution
    attributes:
      label: Proposed solution
      description: What should happen instead?
    validations:
      required: true
  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives considered
