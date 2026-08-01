package entities

type ValidatedToDoList struct {
	ToDoList
	isValidated bool
}

func (vt *ValidatedToDoList) IsValid() bool {
	return vt.isValidated
}

func NewValidatedToDoList(todoList *ToDoList) (*ValidatedToDoList, error) {
	if err := todoList.validate(); err != nil {
		return nil, err
	}

	return &ValidatedToDoList{
		ToDoList:    *todoList,
		isValidated: true,
	}, nil
}
