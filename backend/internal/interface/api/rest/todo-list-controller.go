package rest

import (
	"net/http"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/command"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/application/interfaces"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/rest/dto/mapper"
	"github.com/powerofcreation/simpleshoppinglistapp/internal/interface/api/rest/dto/request"
)

type ToDoListController struct {
	service interfaces.ToDoListService
}

func NewToDoListController(e *echo.Echo, service interfaces.ToDoListService) *ToDoListController {
	controller := &ToDoListController{
		service: service,
	}

	e.POST("/api/v1/todo-lists", controller.CreateToDoListController)
	e.GET("/api/v1/todo-lists", controller.GetAllToDoListsController)
	e.PUT("/api/v1/todo-lists/:id", controller.UpdateToDoListController)
	e.DELETE("/api/v1/todo-lists/:id", controller.DeleteToDoListController)
	e.Use(middleware.Recover())

	return controller
}

func (pc *ToDoListController) CreateToDoListController(c echo.Context) error {
	var createToDoListRequest request.CreateToDoListRequest

	if err := c.Bind(&createToDoListRequest); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Failed to parse request body",
		})
	}

	toDoListCommand, err := createToDoListRequest.ToCreateToDoListCommand()
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid ToDoList Id format",
		})
	}

	result, err := pc.service.CreateToDoList(toDoListCommand)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to create ToDoList",
		})
	}

	response := mapper.ToToDoListResponse(result.Result)

	return c.JSON(http.StatusCreated, response)
}

func (pc *ToDoListController) GetAllToDoListsController(c echo.Context) error {
	toDoLists, err := pc.service.FindAllToDoLists()
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to fetch ToDoLists",
		})
	}

	response := mapper.ToToDoListListResponse(toDoLists.Result)

	return c.JSON(http.StatusOK, response)
}

func (pc *ToDoListController) UpdateToDoListController(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid ToDoList Id format",
		})
	}

	var updateRequest request.UpdateToDoListRequest
	if err := c.Bind(&updateRequest); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Failed to parse request body",
		})
	}

	result, err := pc.service.UpdateToDoList(updateRequest.ToUpdateToDoListCommand(id))
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to update ToDoList",
		})
	}

	response := mapper.ToToDoListResponse(result.Result)
	return c.JSON(http.StatusOK, response)
}

func (pc *ToDoListController) DeleteToDoListController(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid ToDoList Id format",
		})
	}

	_, err = pc.service.DeleteToDoList(&command.DeleteToDoListCommand{Id: id})
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to delete ToDoList",
		})
	}

	return c.NoContent(http.StatusNoContent)
}

/*func (pc *ToDoListController) GetToDoListByIdController(c echo.Context) error {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Invalid ToDoList Id format",
		})
	}

	toDoList, err := pc.service.FindToDoListById(&query.GetToDoListByIdQuery{Id: id})
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{
			"error": "Failed to fetch ToDoList",
		})
	}

	if toDoList == nil {
		return c.JSON(http.StatusNotFound, map[string]string{
			"error": "ToDoList not found",
		})
	}

	response := mapper.ToToDoListResponse(toDoList.Result)

	return c.JSON(http.StatusOK, response)
}
*/
